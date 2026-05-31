import type pg from "pg";

import type {
  TransactionFilters,
  TransactionRawDetails,
  TransactionsResponse,
  TransactionUpdateRequest,
} from "../../shared/management.ts";
import { sql, toQuery } from "../db/sql.ts";
import { listCategories } from "./service.ts";

export type TransactionRow = {
  amount: string;
  booking_date: string;
  category_id: string | null;
  category_name: string | null;
  classification_method: string | null;
  description: string;
  id: string;
  is_excluded_from_budget: boolean;
  is_fixed_cost: boolean;
  is_income: boolean;
  is_one_off: boolean;
  is_recurring: boolean;
  is_savings: boolean;
  is_transfer: boolean;
  merchant: string | null;
  needs_review: boolean;
};

export type TransactionMatchRow = TransactionRow & {
  category_matches: boolean;
  has_manual_override: boolean;
  merchant_matches: boolean;
};

export async function listTransactions(
  pool: pg.Pool,
  filters: TransactionFilters = {},
): Promise<TransactionsResponse> {
  const where = buildTransactionWhere(filters);
  const [categories, merchants, transactions] = await Promise.all([
    listCategories(pool),
    listMerchantNames(pool),
    pool.query<TransactionRow>(
      `
        SELECT
          enriched_transactions.id,
          raw_transactions.booking_date::text,
          raw_transactions.amount::text,
          COALESCE(merchants.name, raw_transactions.counterparty_name, 'Unknown') AS merchant,
          raw_transactions.description,
          categories.id::text AS category_id,
          categories.name AS category_name,
          COALESCE(enriched_transactions.classification_method, 'none') AS classification_method,
          enriched_transactions.needs_review,
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
        ${where.clause}
        ORDER BY raw_transactions.booking_date DESC, enriched_transactions.id DESC
        LIMIT 100
      `,
      where.values,
    ),
  ]);

  return {
    categories,
    merchants,
    transactions: transactions.rows.map(transactionRow),
  };
}

export async function getTransactionRawDetails(
  pool: pg.Pool,
  transactionId: number,
): Promise<TransactionRawDetails> {
  const result = await pool.query<{
    account_iban: string | null;
    account_name: string;
    amount: string;
    booking_date: string;
    category_name: string | null;
    counterparty_iban: string | null;
    counterparty_name: string | null;
    currency: string;
    description: string;
    first_seen_at: string;
    id: string;
    last_seen_at: string;
    merchant: string | null;
    provider: string;
    provider_transaction_id: string | null;
    raw_payload_json: unknown;
    source_hash: string;
    value_date: string | null;
  }>(
    `
      SELECT
        enriched_transactions.id,
        raw_transactions.booking_date::text,
        raw_transactions.amount::text,
        COALESCE(merchants.name, raw_transactions.counterparty_name, 'Unknown') AS merchant,
        raw_transactions.description,
        categories.name AS category_name,
        accounts.name AS account_name,
        accounts.iban AS account_iban,
        raw_transactions.provider,
        raw_transactions.provider_transaction_id,
        raw_transactions.source_hash,
        raw_transactions.value_date::text,
        raw_transactions.currency,
        raw_transactions.counterparty_name,
        raw_transactions.counterparty_iban,
        raw_transactions.raw_payload_json,
        raw_transactions.first_seen_at::text,
        raw_transactions.last_seen_at::text
      FROM enriched_transactions
      JOIN raw_transactions ON raw_transactions.id = enriched_transactions.raw_transaction_id
      JOIN accounts ON accounts.id = raw_transactions.account_id
      LEFT JOIN merchants ON merchants.id = enriched_transactions.merchant_id
      LEFT JOIN categories ON categories.id = enriched_transactions.category_id
      WHERE enriched_transactions.id = $1
    `,
    [transactionId],
  );
  const row = result.rows[0];
  if (!row) {
    throw new Error("Transaction not found");
  }

  return {
    amount: row.amount,
    bookingDate: row.booking_date,
    categoryName: row.category_name,
    description: row.description,
    details: [
      { label: "Account", value: row.account_name },
      { label: "IBAN", value: displayValue(row.account_iban) },
      { label: "Provider", value: row.provider },
      { label: "Provider transaction ID", value: displayValue(row.provider_transaction_id) },
      { label: "Source hash", value: row.source_hash },
      { label: "Value date", value: displayValue(row.value_date) },
      { label: "Currency", value: row.currency },
      { label: "Counterparty", value: displayValue(row.counterparty_name) },
      { label: "Counterparty IBAN", value: displayValue(row.counterparty_iban) },
      { label: "First seen", value: row.first_seen_at },
      { label: "Last seen", value: row.last_seen_at },
    ],
    id: Number(row.id),
    merchant: row.merchant ?? "Unknown",
    payloadJson: JSON.stringify(row.raw_payload_json ?? {}, null, 2),
  };
}

export async function updateTransaction(
  pool: pg.Pool,
  transactionId: number,
  update: TransactionUpdateRequest,
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const merchantId = await upsertMerchant(client, update.merchantName, update.categoryId);
    await upsertManualOverride(client, transactionId, update, merchantId);
    if (update.createAlias && merchantId !== null) {
      await upsertMerchantAlias(client, transactionId, merchantId);
    }
    await client.query(
      toQuery(sql`
        UPDATE enriched_transactions
        SET
          category_id = ${update.categoryId},
          merchant_id = ${merchantId},
          is_transfer = ${update.flags.isTransfer},
          is_savings = ${update.flags.isSavings},
          is_one_off = ${update.flags.isOneOff},
          is_excluded_from_budget = ${update.flags.isExcludedFromBudget},
          is_variable_cost = NOT (${update.flags.isTransfer} OR ${update.flags.isSavings}),
          needs_review = false,
          classification_method = 'manual_override',
          classification_confidence = 1,
          classification_reason = 'Edited from transaction workspace.',
          classification_model = NULL,
          classification_runtime = NULL,
          classification_prompt_version = NULL,
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

async function listMerchantNames(pool: pg.Pool): Promise<string[]> {
  const result = await pool.query<{ merchant: string }>(`
    SELECT DISTINCT COALESCE(merchants.name, raw_transactions.counterparty_name) AS merchant
    FROM enriched_transactions
    JOIN raw_transactions ON raw_transactions.id = enriched_transactions.raw_transaction_id
    LEFT JOIN merchants ON merchants.id = enriched_transactions.merchant_id
    WHERE COALESCE(merchants.name, raw_transactions.counterparty_name) IS NOT NULL
      AND COALESCE(merchants.name, raw_transactions.counterparty_name) <> ''
    ORDER BY merchant
  `);
  return result.rows.map((row) => row.merchant);
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

async function upsertManualOverride(
  client: pg.PoolClient,
  transactionId: number,
  update: TransactionUpdateRequest,
  merchantId: number | null,
): Promise<void> {
  await client.query(
    toQuery(sql`
      INSERT INTO manual_overrides (enriched_transaction_id, category_id, merchant_id, flags_json)
      VALUES (
        ${transactionId},
        ${update.categoryId},
        ${merchantId},
        ${JSON.stringify({
          is_excluded_from_budget: update.flags.isExcludedFromBudget,
          is_one_off: update.flags.isOneOff,
          is_savings: update.flags.isSavings,
          is_transfer: update.flags.isTransfer,
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

function buildTransactionWhere(filters: TransactionFilters): { clause: string; values: unknown[] } {
  const clauses: string[] = [];
  const values: unknown[] = [];
  const add = (clause: string, value?: unknown) => {
    clauses.push(clause.replace("?", `$${values.length + 1}`));
    if (value !== undefined) {
      values.push(value);
    }
  };

  if (filters.needsReview !== undefined) {
    add("enriched_transactions.needs_review = ?", filters.needsReview);
  }
  if (filters.query) {
    const param = `$${values.length + 1}`;
    clauses.push(`(
      raw_transactions.description ILIKE '%' || ${param} || '%'
      OR raw_transactions.counterparty_name ILIKE '%' || ${param} || '%'
      OR merchants.name ILIKE '%' || ${param} || '%'
    )`);
    values.push(filters.query);
  }
  if (filters.month) {
    add("to_char(raw_transactions.booking_date, 'YYYY-MM') = ?", filters.month);
  }
  if (filters.category) {
    add("categories.name = ?", filters.category);
  }
  if (filters.merchant) {
    add("COALESCE(merchants.name, raw_transactions.counterparty_name) = ?", filters.merchant);
  }
  addAmountClause("ABS(raw_transactions.amount) >= ?", filters.minAmount, clauses, values);
  addAmountClause("ABS(raw_transactions.amount) <= ?", filters.maxAmount, clauses, values);
  const kindClause = kindFilter(filters.kind);
  if (kindClause) {
    clauses.push(kindClause);
  }

  return { clause: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "", values };
}

function addAmountClause(
  clause: string,
  amount: string | undefined,
  clauses: string[],
  values: unknown[],
): void {
  if (!amount) {
    return;
  }
  const parsed = Number(amount.replace(",", ""));
  if (!Number.isFinite(parsed)) {
    clauses.push("FALSE");
    return;
  }
  clauses.push(clause.replace("?", `$${values.length + 1}`));
  values.push(Math.abs(parsed));
}

function kindFilter(kind: string | undefined): string {
  switch (kind) {
    case "excluded":
      return "enriched_transactions.is_excluded_from_budget";
    case "fixed":
      return "enriched_transactions.is_fixed_cost";
    case "income":
      return "enriched_transactions.is_income";
    case "one_off":
      return "enriched_transactions.is_one_off";
    case "recurring":
      return "enriched_transactions.is_recurring";
    case "savings":
      return "enriched_transactions.is_savings";
    case "spending":
      return "raw_transactions.amount < 0 AND NOT enriched_transactions.is_transfer AND NOT enriched_transactions.is_excluded_from_budget";
    case "transfer":
      return "enriched_transactions.is_transfer";
    case "uncategorized":
      return "(categories.name IS NULL OR categories.name = 'Unknown')";
    default:
      return "";
  }
}

export function transactionRow(row: TransactionRow) {
  return {
    amount: row.amount,
    bookingDate: row.booking_date,
    categoryId: row.category_id ? Number(row.category_id) : null,
    categoryName: row.category_name,
    classificationMethod: row.classification_method,
    description: row.description,
    flags: flags(row),
    id: Number(row.id),
    merchant: row.merchant ?? "Unknown",
    needsReview: row.needs_review,
  };
}

function flags(row: TransactionRow): string[] {
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

function displayValue(value: string | null): string {
  return value && value !== "" ? value : "None";
}
