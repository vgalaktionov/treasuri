import type pg from "pg";

import { sql, toQuery } from "../db/sql.ts";
import {
  findHistoricalSimilarityCandidate,
  findMerchantAliasCandidate,
  findRuleCandidate,
} from "./deterministic.ts";
import { selectClassificationCandidate } from "./pipeline.ts";

export async function classifyPendingTransactions(pool: pg.Pool) {
  const client = await pool.connect();
  try {
    const transactions = await loadPendingTransactions(client);
    let classifiedCount = 0;

    for (const transaction of transactions) {
      const candidates = [
        await findRuleCandidate(client, transaction),
        await findMerchantAliasCandidate(client, transaction),
        await findHistoricalSimilarityCandidate(client, transaction),
      ];
      const selected = selectClassificationCandidate(
        candidates.filter((candidate) => candidate !== null),
      );

      if (!selected) {
        continue;
      }

      await client.query(
        toQuery(sql`
          UPDATE enriched_transactions
          SET category_id = ${selected.categoryId},
            merchant_id = ${selected.merchantId ?? null},
            needs_review = false,
            classification_method = ${selected.source},
            classification_confidence = ${selected.confidence},
            classification_reason = ${selected.reason},
            classification_model = NULL,
            classification_prompt_version = NULL,
            updated_at = now()
          WHERE id = ${transaction.enrichedTransactionId}
        `),
      );
      classifiedCount += 1;
    }

    return { classifiedCount };
  } finally {
    client.release();
  }
}

async function loadPendingTransactions(client: pg.PoolClient) {
  const result = await client.query<{
    amount: string;
    counterparty_name: string | null;
    description: string;
    enriched_transaction_id: string;
  }>(`
    SELECT enriched_transactions.id AS enriched_transaction_id,
      raw_transactions.amount::text,
      raw_transactions.counterparty_name,
      raw_transactions.description
    FROM enriched_transactions
    JOIN raw_transactions ON raw_transactions.id = enriched_transactions.raw_transaction_id
    LEFT JOIN manual_overrides
      ON manual_overrides.enriched_transaction_id = enriched_transactions.id
    WHERE enriched_transactions.needs_review = true
      AND manual_overrides.id IS NULL
    ORDER BY raw_transactions.booking_date DESC, enriched_transactions.id DESC
  `);

  return result.rows.map((row) => ({
    amount: row.amount,
    counterpartyName: row.counterparty_name,
    description: row.description,
    enrichedTransactionId: Number(row.enriched_transaction_id),
  }));
}
