import type pg from "pg";

import { recordBalanceSnapshot } from "../balance/snapshots.ts";
import { sql, toQuery } from "../db/sql.ts";
import { normalizePendingTransactions } from "../transactions/normalize.ts";
import { sourceHashForMutation } from "./sourceHash.ts";
import type { BankMutation, BankProvider, SyncResult } from "./types.ts";

export async function syncBankTransactions(
  pool: pg.Pool,
  provider: BankProvider,
): Promise<SyncResult> {
  const client = await pool.connect();
  const syncRunId = await startSyncRun(client, provider.provider);
  let transactionStarted = false;

  try {
    const mutations = await provider.fetchMutations();
    let newTransactionCount = 0;
    let updatedTransactionCount = 0;

    await client.query("BEGIN");
    transactionStarted = true;

    for (const mutation of mutations) {
      const accountId = await upsertAccount(client, provider.provider, mutation);
      const inserted = await upsertRawTransaction(client, accountId, provider.provider, mutation);

      if (inserted) {
        newTransactionCount += 1;
      } else {
        updatedTransactionCount += 1;
      }

      if (mutation.balanceAfterMutation) {
        await recordBalanceSnapshot(client, {
          accountId,
          asOf: mutation.valueDate ?? mutation.bookingDate,
          balance: mutation.balanceAfterMutation,
          currency: mutation.currency,
          source: provider.provider,
          syncRunId,
        });
      }
    }

    await normalizePendingTransactions(client);
    await finishSyncRun(client, syncRunId, newTransactionCount, updatedTransactionCount);
    await client.query("COMMIT");
    transactionStarted = false;

    return { newTransactionCount, provider: provider.provider, syncRunId, updatedTransactionCount };
  } catch (error) {
    if (transactionStarted) {
      await client.query("ROLLBACK");
    }

    await recordFailedSyncRun(client, syncRunId, error);

    throw error;
  } finally {
    client.release();
  }
}

async function startSyncRun(client: pg.PoolClient, provider: string): Promise<number> {
  const result = await client.query<{ id: string }>(
    toQuery(sql`
      INSERT INTO sync_runs (provider, status, metadata_json)
      VALUES (${provider}, 'running', ${JSON.stringify({ source: "bank-sync" })}::jsonb)
      RETURNING id
    `),
  );

  return Number(requiredRow(result).id);
}

async function finishSyncRun(
  client: pg.PoolClient,
  syncRunId: number,
  newTransactionCount: number,
  updatedTransactionCount: number,
): Promise<void> {
  await client.query(
    toQuery(sql`
      UPDATE sync_runs
      SET
        finished_at = now(),
        status = 'completed',
        new_transaction_count = ${newTransactionCount},
        updated_transaction_count = ${updatedTransactionCount}
      WHERE id = ${syncRunId}
    `),
  );
}

async function recordFailedSyncRun(
  client: pg.PoolClient,
  syncRunId: number,
  error: unknown,
): Promise<void> {
  await client.query(
    toQuery(sql`
      UPDATE sync_runs
      SET finished_at = now(), status = 'failed', error_message = ${safeErrorMessage(error)}
      WHERE id = ${syncRunId}
    `),
  );
}

async function upsertAccount(
  client: pg.PoolClient,
  provider: string,
  mutation: BankMutation,
): Promise<number> {
  const result = await client.query<{ id: string }>(
    toQuery(sql`
      INSERT INTO accounts (provider, iban, name, currency)
      VALUES (${provider}, ${mutation.accountIban}, 'Synced current account', ${mutation.currency})
      ON CONFLICT (provider, iban)
      DO UPDATE SET currency = EXCLUDED.currency, updated_at = now()
      RETURNING id
    `),
  );

  return Number(requiredRow(result).id);
}

async function upsertRawTransaction(
  client: pg.PoolClient,
  accountId: number,
  provider: string,
  mutation: BankMutation,
): Promise<boolean> {
  const result = await client.query<{ inserted: boolean }>(
    toQuery(sql`
      INSERT INTO raw_transactions (
        account_id, provider, provider_transaction_id, source_hash, booking_date, value_date,
        amount, currency, counterparty_name, counterparty_iban, description, raw_payload_json
      )
      VALUES (
        ${accountId}, ${provider}, ${mutation.providerTransactionId ?? null},
        ${sourceHashForMutation(mutation)}, ${mutation.bookingDate}, ${mutation.valueDate ?? null},
        ${mutation.amount}, ${mutation.currency}, ${mutation.counterpartyName ?? null},
        ${mutation.counterpartyAccount ?? null}, ${mutation.description},
        ${JSON.stringify(mutation.rawPayload)}::jsonb
      )
      ON CONFLICT (account_id, source_hash)
      DO UPDATE SET
        last_seen_at = now(),
        amount = EXCLUDED.amount,
        counterparty_name = EXCLUDED.counterparty_name,
        counterparty_iban = EXCLUDED.counterparty_iban,
        description = EXCLUDED.description,
        raw_payload_json = EXCLUDED.raw_payload_json
      RETURNING (xmax = 0) AS inserted
    `),
  );

  return requiredRow(result).inserted;
}

function safeErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return sanitizeErrorMessage(error.message);
  }
  return "Unknown sync error";
}

function sanitizeErrorMessage(message: string): string {
  return message
    .replace(/(password|secret|token|authorization|credential)=\S+/gi, "$1=[redacted]")
    .slice(0, 500);
}

function requiredRow<T extends pg.QueryResultRow>(result: pg.QueryResult<T>): T {
  const row = result.rows[0];
  if (!row) {
    throw new Error("Expected database row");
  }
  return row;
}
