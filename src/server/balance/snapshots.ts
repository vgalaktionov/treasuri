import type pg from "pg";

import { sql, toQuery } from "../db/sql.ts";

export type CurrentBalance = {
  asOf: string;
  balance: string;
  currency: string;
  source: string;
};

export async function recordBalanceSnapshot(
  client: pg.PoolClient,
  input: {
    accountId: number;
    asOf: string;
    balance: string;
    currency: string;
    source: string;
    syncRunId: number;
  },
): Promise<void> {
  await client.query(
    toQuery(sql`
      INSERT INTO account_balance_snapshots (account_id, balance, currency, source, as_of, sync_run_id)
      VALUES (
        ${input.accountId}, ${input.balance}, ${input.currency}, ${input.source},
        ${input.asOf}, ${input.syncRunId}
      )
      ON CONFLICT (account_id, source, as_of)
      DO UPDATE SET balance = EXCLUDED.balance, sync_run_id = EXCLUDED.sync_run_id
    `),
  );
}

export async function getCurrentBalance(
  pool: pg.Pool,
  accountIban: string,
): Promise<CurrentBalance | null> {
  const result = await pool.query<CurrentBalance>(
    toQuery(sql`
      SELECT
        account_balance_snapshots.balance::text AS balance,
        account_balance_snapshots.currency,
        account_balance_snapshots.source,
        account_balance_snapshots.as_of::text AS "asOf"
      FROM account_balance_snapshots
      JOIN accounts ON accounts.id = account_balance_snapshots.account_id
      WHERE accounts.iban = ${accountIban}
      ORDER BY account_balance_snapshots.as_of DESC
      LIMIT 1
    `),
  );

  return result.rows[0] ?? null;
}
