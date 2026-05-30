import type pg from "pg";

import { sql, toQuery } from "../db/sql.ts";
import type { ClassificationCandidate } from "./pipeline.ts";

export type TransactionForClassification = {
  amount: string;
  counterpartyName: string | null;
  description: string;
};

export async function findRuleCandidate(
  client: pg.PoolClient,
  transaction: TransactionForClassification,
): Promise<ClassificationCandidate | null> {
  const result = await client.query<{
    category_id: string;
    merchant_id: string | null;
    name: string;
  }>(
    toQuery(sql`
      SELECT category_id, merchant_id, name
      FROM categorization_rules
      WHERE is_active = true
        AND category_id IS NOT NULL
        AND (
          (field = 'description' AND operator = 'contains' AND ${transaction.description} ILIKE '%' || pattern || '%')
          OR (field = 'counterparty_name' AND operator = 'contains' AND ${transaction.counterpartyName ?? ""} ILIKE '%' || pattern || '%')
          OR (field = 'description' AND operator = 'exact' AND lower(${transaction.description}) = lower(pattern))
          OR (field = 'counterparty_name' AND operator = 'exact' AND lower(${transaction.counterpartyName ?? ""}) = lower(pattern))
        )
      ORDER BY priority ASC, id ASC
      LIMIT 1
    `),
  );
  const row = result.rows[0];
  if (!row) {
    return null;
  }
  const candidate: ClassificationCandidate = {
    categoryId: Number(row.category_id),
    confidence: 1,
    reason: `Matched rule: ${row.name}`,
    source: "rule",
  };
  if (row.merchant_id) {
    candidate.merchantId = Number(row.merchant_id);
  }
  return candidate;
}

export async function findMerchantAliasCandidate(
  client: pg.PoolClient,
  transaction: TransactionForClassification,
): Promise<ClassificationCandidate | null> {
  const haystack = `${transaction.counterpartyName ?? ""} ${transaction.description}`;
  const result = await client.query<{
    category_id: string;
    merchant_id: string;
  }>(
    toQuery(sql`
      SELECT merchants.id AS merchant_id, merchants.default_category_id AS category_id
      FROM merchant_aliases
      JOIN merchants ON merchants.id = merchant_aliases.merchant_id
      WHERE merchant_aliases.is_active = true
        AND merchants.default_category_id IS NOT NULL
        AND (
          (merchant_aliases.match_type = 'contains' AND ${haystack} ILIKE '%' || merchant_aliases.match_text || '%')
          OR (merchant_aliases.match_type = 'exact' AND lower(${haystack}) = lower(merchant_aliases.match_text))
        )
      ORDER BY merchant_aliases.priority ASC, merchant_aliases.id ASC
      LIMIT 1
    `),
  );
  const row = result.rows[0];
  if (!row) {
    return null;
  }
  return {
    categoryId: Number(row.category_id),
    confidence: 0.95,
    merchantId: Number(row.merchant_id),
    reason: "Matched merchant alias",
    source: "merchant_alias",
  };
}

export async function findHistoricalSimilarityCandidate(
  client: pg.PoolClient,
  transaction: TransactionForClassification,
): Promise<ClassificationCandidate | null> {
  const result = await client.query<{ category_id: string; merchant_id: string | null }>(
    toQuery(sql`
      SELECT enriched_transactions.category_id, enriched_transactions.merchant_id
      FROM enriched_transactions
      JOIN raw_transactions ON raw_transactions.id = enriched_transactions.raw_transaction_id
      WHERE enriched_transactions.needs_review = false
        AND enriched_transactions.category_id IS NOT NULL
        AND (
          lower(raw_transactions.counterparty_name) = lower(${transaction.counterpartyName ?? ""})
          OR lower(raw_transactions.description) = lower(${transaction.description})
        )
      ORDER BY enriched_transactions.updated_at DESC
      LIMIT 1
    `),
  );
  const row = result.rows[0];
  if (!row) {
    return null;
  }
  const candidate: ClassificationCandidate = {
    categoryId: Number(row.category_id),
    confidence: 0.7,
    reason: "Matched historical transaction",
    source: "historical_similarity",
  };
  if (row.merchant_id) {
    candidate.merchantId = Number(row.merchant_id);
  }
  return candidate;
}
