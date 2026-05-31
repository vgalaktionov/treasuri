import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { describe, expect, it } from "vitest";

import { getCurrentBalance } from "../../../src/server/balance/snapshots.ts";
import { AbnBankProvider, parseMutationsListResponse } from "../../../src/server/bank/abn/index.ts";
import { createFakeBankProvider } from "../../../src/server/bank/fake.ts";
import { syncBankTransactions } from "../../../src/server/bank/sync.ts";
import type { BankProvider } from "../../../src/server/bank/types.ts";
import { runMigrations } from "../../../src/server/db/migrations.ts";
import { withPool } from "../../../src/server/db/pool.ts";
import { sampleAccountIban, sampleTransactions } from "../../../src/server/sample/data.ts";

describe("syncBankTransactions", () => {
  it("imports fake mutations idempotently and derives current balance from snapshots", async () => {
    const container = await new PostgreSqlContainer("postgres:16-alpine").start();

    try {
      await withPool(container.getConnectionUri(), async (pool) => {
        await runMigrations(pool);

        const firstSync = await syncBankTransactions(pool, createFakeBankProvider());
        const secondSync = await syncBankTransactions(pool, createFakeBankProvider());

        const counts = await pool.query<{
          balance_snapshots: string;
          completed_sync_runs: string;
          enriched_transactions: string;
          manual_balance_settings: string;
          raw_transactions: string;
          review_transactions: string;
        }>(`
          SELECT
            (SELECT count(*) FROM raw_transactions) AS raw_transactions,
            (SELECT count(*) FROM enriched_transactions) AS enriched_transactions,
            (SELECT count(*) FROM enriched_transactions WHERE needs_review = true) AS review_transactions,
            (SELECT count(*) FROM account_balance_snapshots) AS balance_snapshots,
            (SELECT count(*) FROM sync_runs WHERE metadata_json @> '{"source":"bank-sync"}' AND status = 'completed') AS completed_sync_runs,
            (SELECT count(*) FROM app_settings WHERE key IN ('current_balance', 'manual_current_balance')) AS manual_balance_settings
        `);
        const currentBalance = await getCurrentBalance(pool, sampleAccountIban);

        expect(firstSync).toMatchObject({
          newTransactionCount: sampleTransactions.length,
          provider: "fake",
          updatedTransactionCount: 0,
        });
        expect(secondSync).toMatchObject({
          newTransactionCount: 0,
          provider: "fake",
          updatedTransactionCount: sampleTransactions.length,
        });
        expect(counts.rows[0]).toEqual({
          balance_snapshots: String(sampleTransactions.length),
          completed_sync_runs: "2",
          enriched_transactions: String(sampleTransactions.length),
          manual_balance_settings: "0",
          raw_transactions: String(sampleTransactions.length),
          review_transactions: String(sampleTransactions.length),
        });
        expect(currentBalance).toMatchObject({
          balance: "3400.00",
          currency: "EUR",
          source: "fake",
        });
      });
    } finally {
      await container.stop();
    }
  }, 120_000);

  it("records provider failures without leaking obvious secret values", async () => {
    const container = await new PostgreSqlContainer("postgres:16-alpine").start();
    const failingProvider: BankProvider = {
      provider: "fake",
      async fetchMutations() {
        throw new Error("upstream failed token=abc123 password=secret-value");
      },
    };

    try {
      await withPool(container.getConnectionUri(), async (pool) => {
        await runMigrations(pool);

        await expect(syncBankTransactions(pool, failingProvider)).rejects.toThrow(
          "upstream failed",
        );

        const failedRuns = await pool.query<{ error_message: string; status: string }>(
          "SELECT status, error_message FROM sync_runs ORDER BY id DESC LIMIT 1",
        );

        expect(failedRuns.rows[0]).toEqual({
          error_message: "upstream failed token=[redacted] password=[redacted]",
          status: "failed",
        });
      });
    } finally {
      await container.stop();
    }
  }, 120_000);

  it("imports ABN mutations through the in-repo provider idempotently", async () => {
    const container = await new PostgreSqlContainer("postgres:16-alpine").start();
    const provider = new AbnBankProvider(
      {
        accountIban: "NL25ABNA0123456789",
        cardNumber: "123",
        softToken: "12345",
      },
      {
        client: {
          async fetchMutations() {
            return parseMutationsListResponse(abnMutationsPayload(), "NL25ABNA0123456789");
          },
        },
      },
    );

    try {
      await withPool(container.getConnectionUri(), async (pool) => {
        await runMigrations(pool);

        const firstSync = await syncBankTransactions(pool, provider);
        const secondSync = await syncBankTransactions(pool, provider);

        const rows = await pool.query<{
          balance: string;
          counterparty_iban: string | null;
          provider_transaction_id: string | null;
          source_hash: string;
          source_inquiry_number: string | null;
        }>(`
          SELECT
            raw_transactions.provider_transaction_id,
            raw_transactions.source_hash,
            raw_transactions.counterparty_iban,
            raw_transactions.raw_payload_json->>'sourceInquiryNumber' AS source_inquiry_number,
            account_balance_snapshots.balance::text AS balance
          FROM raw_transactions
          JOIN account_balance_snapshots
            ON account_balance_snapshots.account_id = raw_transactions.account_id
           AND account_balance_snapshots.as_of::date = raw_transactions.booking_date
          WHERE raw_transactions.provider = 'abn_amro'
          ORDER BY raw_transactions.provider_transaction_id NULLS LAST
        `);
        const syncRows = await pool.query<{ metadata_json: Record<string, unknown> }>(`
          SELECT metadata_json
          FROM sync_runs
          WHERE provider = 'abn_amro'
          ORDER BY id DESC
          LIMIT 1
        `);

        expect(firstSync).toMatchObject({
          newTransactionCount: 2,
          provider: "abn_amro",
          updatedTransactionCount: 0,
        });
        expect(secondSync).toMatchObject({
          newTransactionCount: 0,
          provider: "abn_amro",
          updatedTransactionCount: 2,
        });
        expect(rows.rows).toHaveLength(2);
        expect(rows.rows[0]).toMatchObject({
          balance: "3.50",
          counterparty_iban: null,
          provider_transaction_id: "NL25ABNA0123456789:0530135401918619",
          source_inquiry_number: "0530135401918619",
        });
        expect(rows.rows[1]?.provider_transaction_id).toBeNull();
        expect(rows.rows[1]?.source_hash).toMatch(/^[a-f0-9]{64}$/);
        expect(syncRows.rows[0]?.metadata_json).toMatchObject({
          clear_cache_indicator: false,
          cursor_reset: false,
          last_mutation_key: "cursor-abn",
          source: "bank-sync",
        });
      });
    } finally {
      await container.stop();
    }
  }, 120_000);
});

function abnMutationsPayload() {
  return {
    mutationsList: {
      clearCacheIndicator: false,
      lastMutationKey: "cursor-abn",
      mutations: [
        {
          mutation: {
            accountNumber: "NL25ABNA0123456789",
            accountNumberType: "IBAN",
            amount: -2000.99,
            balanceAfterMutation: 3.5,
            bookDate: "2026-05-30",
            counterAccountName: "Jumbo Amsterdam,PAS123",
            counterAccountNumber: "",
            currencyIsoCode: "EUR",
            descriptionLines: ["BEA, Apple Pay", "Jumbo Amsterdam"],
            sourceInquiryNumber: "0530135401918619",
            transactionTimestamp: "20260530135401600",
            valueDate: "2026-05-30",
          },
        },
        {
          mutation: {
            accountNumber: "NL25ABNA0123456789",
            accountNumberType: "IBAN",
            amount: "-42.10",
            balanceAfterMutation: "1960.40",
            bookDate: "2026-05-31",
            counterAccountName: "Unknown Counterparty",
            counterAccountNumber: "",
            currencyIsoCode: "EUR",
            descriptionLines: ["No source inquiry"],
            transactionTimestamp: "20260531120000000",
          },
        },
      ],
    },
  };
}
