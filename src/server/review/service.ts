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
      counterparty_name: string | null;
      currency: string;
      description: string;
      id: string;
    }>(`
      SELECT
        enriched_transactions.id,
        raw_transactions.booking_date::text,
        raw_transactions.amount::text,
        raw_transactions.currency,
        raw_transactions.counterparty_name,
        raw_transactions.description,
        categories.id::text AS category_id,
        categories.name AS category_name
      FROM enriched_transactions
      JOIN raw_transactions ON raw_transactions.id = enriched_transactions.raw_transaction_id
      LEFT JOIN categories ON categories.id = enriched_transactions.category_id
      WHERE enriched_transactions.needs_review = true
      ORDER BY raw_transactions.booking_date DESC, enriched_transactions.id DESC
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
      counterpartyName: row.counterparty_name,
      currency: row.currency,
      description: row.description,
      id: Number(row.id),
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
      await setManualOverride(client, transactionId, action.categoryId, false);
    } else {
      await setManualOverride(client, transactionId, action.categoryId ?? null, true);
    }

    const count = await reviewCount(client);
    await client.query("COMMIT");
    return { reviewCount: count, transactionId };
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
  excludedFromBudget: boolean,
): Promise<void> {
  await client.query(
    toQuery(sql`
      INSERT INTO manual_overrides (enriched_transaction_id, category_id, flags_json)
      VALUES (
        ${transactionId},
        ${categoryId},
        ${JSON.stringify({ is_excluded_from_budget: excludedFromBudget })}::jsonb
      )
      ON CONFLICT (enriched_transaction_id)
      DO UPDATE SET
        category_id = EXCLUDED.category_id,
        flags_json = EXCLUDED.flags_json,
        updated_at = now()
    `),
  );
  await client.query(
    toQuery(sql`
      UPDATE enriched_transactions
      SET
        category_id = COALESCE(${categoryId}, category_id),
        is_excluded_from_budget = ${excludedFromBudget},
        needs_review = false,
        classification_method = 'manual_override',
        classification_confidence = 1,
        classification_reason = 'Reviewed manually.',
        updated_at = now()
      WHERE id = ${transactionId}
    `),
  );
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
