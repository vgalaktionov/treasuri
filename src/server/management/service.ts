import type pg from "pg";

import type { RulePreviewRequest, TransactionsResponse } from "../../shared/management.ts";
import { sql, toQuery } from "../db/sql.ts";

export async function listTransactions(
  pool: pg.Pool,
  filters: { category?: string; query?: string } = {},
): Promise<TransactionsResponse> {
  const [categories, transactions] = await Promise.all([
    listCategories(pool),
    pool.query<{
      amount: string;
      booking_date: string;
      category_id: string | null;
      category_name: string | null;
      description: string;
      id: string;
      merchant: string | null;
      needs_review: boolean;
    }>(
      `
        SELECT
          enriched_transactions.id,
          raw_transactions.booking_date::text,
          raw_transactions.amount::text,
          COALESCE(merchants.name, raw_transactions.counterparty_name, 'Unknown') AS merchant,
          raw_transactions.description,
          categories.id::text AS category_id,
          categories.name AS category_name,
          enriched_transactions.needs_review
        FROM enriched_transactions
        JOIN raw_transactions ON raw_transactions.id = enriched_transactions.raw_transaction_id
        LEFT JOIN merchants ON merchants.id = enriched_transactions.merchant_id
        LEFT JOIN categories ON categories.id = enriched_transactions.category_id
        WHERE ($1::text = '' OR raw_transactions.description ILIKE '%' || $1 || '%' OR raw_transactions.counterparty_name ILIKE '%' || $1 || '%' OR merchants.name ILIKE '%' || $1 || '%')
          AND ($2::text = '' OR categories.name = $2)
        ORDER BY raw_transactions.booking_date DESC, enriched_transactions.id DESC
        LIMIT 100
      `,
      [filters.query ?? "", filters.category ?? ""],
    ),
  ]);

  return {
    categories,
    transactions: transactions.rows.map(transactionRow),
  };
}

export async function listCategories(pool: pg.Pool) {
  const result = await pool.query<{ id: string; name: string }>(
    "SELECT id, name FROM categories ORDER BY name",
  );
  return result.rows.map((row) => ({ id: Number(row.id), name: row.name }));
}

export async function updateTransactionCategory(
  pool: pg.Pool,
  transactionId: number,
  categoryId: number,
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      toQuery(sql`
        INSERT INTO manual_overrides (enriched_transaction_id, category_id, flags_json)
        VALUES (${transactionId}, ${categoryId}, '{}'::jsonb)
        ON CONFLICT (enriched_transaction_id)
        DO UPDATE SET category_id = EXCLUDED.category_id, updated_at = now()
      `),
    );
    await client.query(
      toQuery(sql`
        UPDATE enriched_transactions
        SET category_id = ${categoryId},
            needs_review = false,
            classification_method = 'manual_override',
            classification_confidence = 1,
            classification_reason = 'Edited from transaction list.',
            updated_at = now()
        WHERE id = ${transactionId}
      `),
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function previewRule(pool: pg.Pool, rule: RulePreviewRequest) {
  const result = await matchingTransactions(pool, rule);
  return {
    matches: result.rows.filter((row) => !row.has_manual_override).map(transactionRow),
    skippedManualCount: result.rows.filter((row) => row.has_manual_override).length,
  };
}

export async function createRule(pool: pg.Pool, rule: RulePreviewRequest): Promise<number> {
  const result = await pool.query<{ id: string }>(
    toQuery(sql`
      INSERT INTO categorization_rules (name, field, operator, pattern, category_id)
      VALUES (${rule.name}, ${rule.field}, 'contains', ${rule.pattern}, ${rule.categoryId})
      RETURNING id
    `),
  );
  return Number(result.rows[0]?.id);
}

export async function applyRule(pool: pg.Pool, ruleId: number) {
  const rule = await readRule(pool, ruleId);
  const preview = await previewRule(pool, rule);
  if (preview.matches.length === 0) {
    return { skippedManualCount: preview.skippedManualCount, updatedCount: 0 };
  }
  await pool.query(
    `
      UPDATE enriched_transactions
      SET category_id = $2,
          classification_method = 'rule',
          classification_confidence = 1,
          classification_reason = 'Backfilled from rule.',
          updated_at = now()
      WHERE id = ANY($1::bigint[])
        AND NOT EXISTS (
          SELECT 1 FROM manual_overrides
          WHERE manual_overrides.enriched_transaction_id = enriched_transactions.id
        )
    `,
    [preview.matches.map((match) => match.id), rule.categoryId],
  );
  return { skippedManualCount: preview.skippedManualCount, updatedCount: preview.matches.length };
}

export async function listRules(pool: pg.Pool) {
  const [categories, rules] = await Promise.all([
    listCategories(pool),
    pool.query<{
      category_name: string | null;
      field: string;
      id: string;
      is_active: boolean;
      name: string;
      pattern: string;
    }>(`
      SELECT categorization_rules.id, categorization_rules.name, categorization_rules.field,
        categorization_rules.pattern, categorization_rules.is_active, categories.name AS category_name
      FROM categorization_rules
      LEFT JOIN categories ON categories.id = categorization_rules.category_id
      ORDER BY categorization_rules.priority, categorization_rules.id
    `),
  ]);
  return {
    categories,
    rules: rules.rows.map((row) => ({
      categoryName: row.category_name,
      field: row.field,
      id: Number(row.id),
      isActive: row.is_active,
      name: row.name,
      pattern: row.pattern,
    })),
  };
}

export async function listRecurring(pool: pg.Pool) {
  const result = await pool.query<{
    category_name: string | null;
    cadence: string;
    expected_amount: string | null;
    id: string;
    is_confirmed: boolean;
    name: string;
    next_expected_date: string | null;
  }>(`
    SELECT recurring_series.id, recurring_series.name, recurring_series.cadence,
      recurring_series.expected_amount::text, recurring_series.next_expected_date::text,
      recurring_series.is_confirmed, categories.name AS category_name
    FROM recurring_series
    LEFT JOIN categories ON categories.id = recurring_series.category_id
    WHERE recurring_series.is_active = true
    ORDER BY recurring_series.next_expected_date NULLS LAST, recurring_series.name
  `);
  return {
    series: result.rows.map((row) => ({
      amount: row.expected_amount,
      categoryName: row.category_name,
      cadence: row.cadence,
      id: Number(row.id),
      isConfirmed: row.is_confirmed,
      name: row.name,
      nextExpectedDate: row.next_expected_date,
    })),
  };
}

async function readRule(pool: pg.Pool, ruleId: number): Promise<RulePreviewRequest> {
  const result = await pool.query<{
    category_id: string;
    field: "description" | "counterparty_name";
    name: string;
    pattern: string;
  }>("SELECT name, field, pattern, category_id::text FROM categorization_rules WHERE id = $1", [
    ruleId,
  ]);
  const row = result.rows[0];
  if (!row) {
    throw new Error("Rule not found");
  }
  return {
    categoryId: Number(row.category_id),
    field: row.field,
    name: row.name,
    pattern: row.pattern,
  };
}

function matchingTransactions(pool: pg.Pool, rule: RulePreviewRequest) {
  return pool.query<{
    amount: string;
    booking_date: string;
    category_id: string | null;
    category_name: string | null;
    description: string;
    has_manual_override: boolean;
    id: string;
    merchant: string | null;
    needs_review: boolean;
  }>(
    `
      SELECT enriched_transactions.id, raw_transactions.booking_date::text,
        raw_transactions.amount::text, COALESCE(merchants.name, raw_transactions.counterparty_name, 'Unknown') AS merchant,
        raw_transactions.description, categories.id::text AS category_id, categories.name AS category_name,
        enriched_transactions.needs_review, manual_overrides.id IS NOT NULL AS has_manual_override
      FROM enriched_transactions
      JOIN raw_transactions ON raw_transactions.id = enriched_transactions.raw_transaction_id
      LEFT JOIN merchants ON merchants.id = enriched_transactions.merchant_id
      LEFT JOIN categories ON categories.id = enriched_transactions.category_id
      LEFT JOIN manual_overrides ON manual_overrides.enriched_transaction_id = enriched_transactions.id
      WHERE CASE WHEN $1 = 'counterparty_name'
        THEN raw_transactions.counterparty_name ILIKE '%' || $2 || '%'
        ELSE raw_transactions.description ILIKE '%' || $2 || '%'
      END
      ORDER BY raw_transactions.booking_date DESC, enriched_transactions.id DESC
    `,
    [rule.field, rule.pattern],
  );
}

function transactionRow(row: {
  amount: string;
  booking_date: string;
  category_id: string | null;
  category_name: string | null;
  description: string;
  id: string;
  merchant: string | null;
  needs_review: boolean;
}) {
  return {
    amount: row.amount,
    bookingDate: row.booking_date,
    categoryId: row.category_id ? Number(row.category_id) : null,
    categoryName: row.category_name,
    description: row.description,
    id: Number(row.id),
    merchant: row.merchant ?? "Unknown",
    needsReview: row.needs_review,
  };
}
