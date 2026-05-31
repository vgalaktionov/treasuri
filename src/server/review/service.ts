import type pg from "pg";

import type {
  ReviewActionRequest,
  ReviewActionResponse,
  ReviewInboxResponse,
} from "../../shared/review.ts";
import { sql, toQuery } from "../db/sql.ts";

export async function listReviewInbox(pool: pg.Pool): Promise<ReviewInboxResponse> {
  const [categories, transactions, count] = await Promise.all([
    pool.query<{ id: string; name: string }>("SELECT id, name FROM categories ORDER BY name"),
    pool.query<{
      amount: string;
      booking_date: string;
      category_id: string | null;
      category_name: string | null;
      classification_method: string | null;
      counterparty_name: string | null;
      currency: string;
      description: string;
      id: string;
      is_excluded_from_budget: boolean;
      is_fixed_cost: boolean;
      is_income: boolean;
      is_one_off: boolean;
      is_recurring: boolean;
      is_savings: boolean;
      is_transfer: boolean;
      merchant_name: string | null;
      similar_count: string;
    }>(`
      WITH review_rows AS (
        SELECT
          enriched_transactions.id,
          raw_transactions.booking_date,
          raw_transactions.amount,
          raw_transactions.currency,
          raw_transactions.counterparty_name,
          raw_transactions.description,
          categories.id AS category_id,
          categories.name AS category_name,
          COALESCE(merchants.name, raw_transactions.counterparty_name, 'Unknown') AS merchant_name,
          COALESCE(enriched_transactions.classification_method, 'none') AS classification_method,
          enriched_transactions.is_income,
          enriched_transactions.is_transfer,
          enriched_transactions.is_savings,
          enriched_transactions.is_fixed_cost,
          enriched_transactions.is_recurring,
          enriched_transactions.is_one_off,
          enriched_transactions.is_excluded_from_budget
        FROM enriched_transactions
        JOIN raw_transactions ON raw_transactions.id = enriched_transactions.raw_transaction_id
        LEFT JOIN merchants ON merchants.id = enriched_transactions.merchant_id
        LEFT JOIN categories ON categories.id = enriched_transactions.category_id
        WHERE enriched_transactions.needs_review = true
      )
      SELECT
        review_rows.id::text,
        review_rows.booking_date::text,
        review_rows.amount::text,
        review_rows.currency,
        review_rows.counterparty_name,
        review_rows.description,
        review_rows.category_id::text,
        review_rows.category_name,
        review_rows.merchant_name,
        review_rows.classification_method,
        review_rows.is_income,
        review_rows.is_transfer,
        review_rows.is_savings,
        review_rows.is_fixed_cost,
        review_rows.is_recurring,
        review_rows.is_one_off,
        review_rows.is_excluded_from_budget,
        (
          SELECT count(*)::text
          FROM enriched_transactions AS similar_txn
          JOIN raw_transactions AS similar_raw ON similar_raw.id = similar_txn.raw_transaction_id
          LEFT JOIN manual_overrides
            ON manual_overrides.enriched_transaction_id = similar_txn.id
          WHERE similar_txn.id <> review_rows.id
            AND manual_overrides.id IS NULL
            AND lower(COALESCE(NULLIF(similar_raw.counterparty_name, ''), similar_raw.description)) =
              lower(COALESCE(NULLIF(review_rows.counterparty_name, ''), review_rows.description))
        ) AS similar_count
      FROM review_rows
      ORDER BY review_rows.booking_date DESC, review_rows.id DESC
      LIMIT 50
    `),
    reviewCount(pool),
  ]);

  return {
    categories: categories.rows.map((row) => ({ id: Number(row.id), name: row.name })),
    reviewCount: count,
    transactions: transactions.rows.map((row) => ({
      amount: row.amount,
      bookingDate: row.booking_date,
      categoryId: row.category_id ? Number(row.category_id) : null,
      categoryName: row.category_name,
      classificationMethod: row.classification_method,
      counterpartyName: row.counterparty_name,
      currency: row.currency,
      description: row.description,
      flags: flags(row),
      id: Number(row.id),
      merchantName: row.merchant_name ?? "Unknown",
      similarCount: Number(row.similar_count),
    })),
  };
}

export async function applyReviewAction(
  pool: pg.Pool,
  transactionId: number,
  action: ReviewActionRequest,
): Promise<ReviewActionResponse> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await ensureReviewTransaction(client, transactionId);

    if (action.action === "accept") {
      await acceptTransaction(client, transactionId);
    } else if (action.action === "change") {
      const merchantId = await upsertMerchant(client, action.merchantName, action.categoryId);
      const similarIds = action.applySimilar
        ? await similarTransactionIds(client, transactionId)
        : [];
      await setManualOverride(client, transactionId, action.categoryId, merchantId, action.flags);
      if (action.createAlias && merchantId !== null) {
        await upsertMerchantAlias(client, transactionId, merchantId);
      }
      for (const similarId of similarIds) {
        await setManualOverride(client, similarId, action.categoryId, merchantId, action.flags);
      }
      const count = await reviewCount(client);
      await client.query("COMMIT");
      return {
        correctedCount: 1 + similarIds.length,
        reviewCount: count,
        ruleDraft:
          action.next === "rule-preview"
            ? await ruleDraftForTransaction(
                client,
                transactionId,
                action.categoryId,
                action.merchantName,
              )
            : null,
        similarCount: similarIds.length,
        transactionId,
      };
    } else {
      const categoryId = action.categoryId ?? null;
      const merchantId =
        categoryId !== null ? await upsertMerchant(client, action.merchantName, categoryId) : null;
      const similarIds = action.applySimilar
        ? await similarTransactionIds(client, transactionId)
        : [];
      await setManualOverride(client, transactionId, categoryId, merchantId, {
        isExcludedFromBudget: true,
        isOneOff: false,
        isSavings: false,
        isTransfer: false,
      });
      if (action.createAlias && merchantId !== null) {
        await upsertMerchantAlias(client, transactionId, merchantId);
      }
      for (const similarId of similarIds) {
        await setManualOverride(client, similarId, categoryId, merchantId, {
          isExcludedFromBudget: true,
          isOneOff: false,
          isSavings: false,
          isTransfer: false,
        });
      }
      const count = await reviewCount(client);
      await client.query("COMMIT");
      return {
        correctedCount: 1 + similarIds.length,
        reviewCount: count,
        ruleDraft: null,
        similarCount: similarIds.length,
        transactionId,
      };
    }

    const count = await reviewCount(client);
    await client.query("COMMIT");
    return {
      correctedCount: 1,
      reviewCount: count,
      ruleDraft: null,
      similarCount: 0,
      transactionId,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function acceptTransaction(client: pg.PoolClient, transactionId: number): Promise<void> {
  await client.query(
    toQuery(sql`
      UPDATE enriched_transactions
      SET needs_review = false, updated_at = now()
      WHERE id = ${transactionId}
    `),
  );
}

async function setManualOverride(
  client: pg.PoolClient,
  transactionId: number,
  categoryId: number | null,
  merchantId: number | null,
  flags: {
    isExcludedFromBudget: boolean;
    isOneOff: boolean;
    isSavings: boolean;
    isTransfer: boolean;
  },
): Promise<void> {
  await client.query(
    toQuery(sql`
      INSERT INTO manual_overrides (enriched_transaction_id, category_id, merchant_id, flags_json)
      VALUES (
        ${transactionId},
        ${categoryId},
        ${merchantId},
        ${JSON.stringify({
          is_excluded_from_budget: flags.isExcludedFromBudget,
          is_one_off: flags.isOneOff,
          is_savings: flags.isSavings,
          is_transfer: flags.isTransfer,
        })}::jsonb
      )
      ON CONFLICT (enriched_transaction_id)
      DO UPDATE SET
        category_id = EXCLUDED.category_id,
        merchant_id = EXCLUDED.merchant_id,
        flags_json = EXCLUDED.flags_json,
        updated_at = now()
    `),
  );
  await client.query(
    toQuery(sql`
        UPDATE enriched_transactions
        SET
          category_id = COALESCE(${categoryId}, category_id),
        merchant_id = COALESCE(${merchantId}, merchant_id),
        is_transfer = ${flags.isTransfer},
        is_savings = ${flags.isSavings},
        is_one_off = ${flags.isOneOff},
        is_excluded_from_budget = ${flags.isExcludedFromBudget},
        is_variable_cost = NOT (${flags.isTransfer} OR ${flags.isSavings}),
        needs_review = false,
        classification_method = 'manual_override',
        classification_confidence = 1,
        classification_reason = 'Reviewed manually.',
        updated_at = now()
      WHERE id = ${transactionId}
    `),
  );
}

async function upsertMerchant(
  client: pg.PoolClient,
  merchantName: string | undefined,
  categoryId: number,
): Promise<number | null> {
  const cleaned = merchantName?.trim();
  if (!cleaned) {
    return null;
  }
  const result = await client.query<{ id: string }>(
    toQuery(sql`
      INSERT INTO merchants (name, normalized_name, default_category_id)
      VALUES (${cleaned}, ${cleaned.toLowerCase()}, ${categoryId})
      ON CONFLICT (normalized_name)
      DO UPDATE SET default_category_id = EXCLUDED.default_category_id, updated_at = now()
      RETURNING id
    `),
  );
  return Number(result.rows[0]?.id);
}

async function upsertMerchantAlias(
  client: pg.PoolClient,
  transactionId: number,
  merchantId: number,
): Promise<void> {
  const result = await client.query<{ match_text: string | null }>(
    `
      SELECT COALESCE(NULLIF(trim(raw_transactions.counterparty_name), ''), NULLIF(trim(raw_transactions.description), '')) AS match_text
      FROM enriched_transactions
      JOIN raw_transactions ON raw_transactions.id = enriched_transactions.raw_transaction_id
      WHERE enriched_transactions.id = $1
    `,
    [transactionId],
  );
  const matchText = result.rows[0]?.match_text;
  if (!matchText) {
    return;
  }
  await client.query(
    toQuery(sql`
      INSERT INTO merchant_aliases (merchant_id, match_text, match_type, priority)
      SELECT ${merchantId}, ${matchText}, 'contains', 50
      WHERE NOT EXISTS (
        SELECT 1
        FROM merchant_aliases
        WHERE merchant_id = ${merchantId}
          AND match_text = ${matchText}
          AND match_type = 'contains'
      )
    `),
  );
}

async function similarTransactionIds(
  client: pg.PoolClient,
  transactionId: number,
): Promise<number[]> {
  const result = await client.query<{ id: string }>(
    `
      WITH source AS (
        SELECT COALESCE(NULLIF(trim(raw_transactions.counterparty_name), ''), NULLIF(trim(raw_transactions.description), '')) AS match_text
        FROM enriched_transactions
        JOIN raw_transactions ON raw_transactions.id = enriched_transactions.raw_transaction_id
        WHERE enriched_transactions.id = $1
      )
      SELECT enriched_transactions.id::text
      FROM enriched_transactions
      JOIN raw_transactions ON raw_transactions.id = enriched_transactions.raw_transaction_id
      CROSS JOIN source
      LEFT JOIN manual_overrides
        ON manual_overrides.enriched_transaction_id = enriched_transactions.id
      WHERE enriched_transactions.id <> $1
        AND manual_overrides.id IS NULL
        AND source.match_text IS NOT NULL
        AND lower(COALESCE(NULLIF(trim(raw_transactions.counterparty_name), ''), NULLIF(trim(raw_transactions.description), ''))) =
          lower(source.match_text)
      ORDER BY raw_transactions.booking_date DESC, enriched_transactions.id DESC
    `,
    [transactionId],
  );
  return result.rows.map((row) => Number(row.id));
}

async function ruleDraftForTransaction(
  client: pg.PoolClient,
  transactionId: number,
  categoryId: number,
  merchantName: string | undefined,
) {
  const result = await client.query<{ counterparty_name: string | null; description: string }>(
    `
      SELECT raw_transactions.counterparty_name, raw_transactions.description
      FROM enriched_transactions
      JOIN raw_transactions ON raw_transactions.id = enriched_transactions.raw_transaction_id
      WHERE enriched_transactions.id = $1
    `,
    [transactionId],
  );
  const row = result.rows[0];
  const pattern =
    row?.counterparty_name?.trim() || row?.description?.trim() || merchantName || "review";
  return {
    categoryId,
    field: "counterparty_name" as const,
    flags: {
      setIsExcludedFromBudget: false,
      setIsFixedCost: false,
      setIsIncome: false,
      setIsSavings: false,
      setIsTransfer: false,
    },
    isActive: true as const,
    merchantName: merchantName?.trim() || undefined,
    name: `Review: ${pattern}`,
    operator: "contains" as const,
    pattern,
    priority: 50,
  };
}

function flags(row: {
  is_excluded_from_budget: boolean;
  is_fixed_cost: boolean;
  is_income: boolean;
  is_one_off: boolean;
  is_recurring: boolean;
  is_savings: boolean;
  is_transfer: boolean;
}): string[] {
  return [
    row.is_income ? "income" : null,
    row.is_transfer ? "transfer" : null,
    row.is_savings ? "savings" : null,
    row.is_fixed_cost ? "fixed" : null,
    row.is_recurring ? "recurring" : null,
    row.is_one_off ? "one-off" : null,
    row.is_excluded_from_budget ? "excluded" : null,
  ].filter((flag): flag is string => flag !== null);
}

async function ensureReviewTransaction(
  client: pg.PoolClient,
  transactionId: number,
): Promise<void> {
  const result = await client.query(
    toQuery(sql`
      SELECT id
      FROM enriched_transactions
      WHERE id = ${transactionId}
    `),
  );
  if (result.rowCount !== 1) {
    throw new Error("Review transaction not found");
  }
}

async function reviewCount(clientOrPool: pg.Pool | pg.PoolClient): Promise<number> {
  const result = await clientOrPool.query<{ count: string }>(
    "SELECT count(*) FROM enriched_transactions WHERE needs_review = true",
  );
  return Number(result.rows[0]?.count ?? 0);
}
