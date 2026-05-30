import type pg from "pg";

import { sql, toQuery } from "../db/sql.ts";

export async function normalizePendingTransactions(client: pg.PoolClient): Promise<number> {
  const result = await client.query<{ id: string }>(
    toQuery(sql`
      INSERT INTO enriched_transactions (
        raw_transaction_id, category_id, needs_review, classification_method,
        classification_confidence, classification_reason
      )
      SELECT
        raw_transactions.id,
        categories.id,
        true,
        'uncategorized',
        0,
        'Created during normalization; classification has not run yet.'
      FROM raw_transactions
      CROSS JOIN categories
      WHERE categories.name = 'Unknown'
        AND NOT EXISTS (
          SELECT 1
          FROM enriched_transactions
          WHERE enriched_transactions.raw_transaction_id = raw_transactions.id
        )
      RETURNING id
    `),
  );

  return result.rowCount ?? 0;
}
