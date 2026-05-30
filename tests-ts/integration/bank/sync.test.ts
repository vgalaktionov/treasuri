import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { describe, expect, it } from "vitest";

import { getCurrentBalance } from "../../../src/server/balance/snapshots.ts";
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
  }, 60_000);

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
  }, 60_000);
});
