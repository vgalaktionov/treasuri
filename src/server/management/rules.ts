import type pg from "pg";

import type { RuleEditorRequest, RulePreviewRequest } from "../../shared/management.ts";
import { sql, toQuery } from "../db/sql.ts";
import { listCategories } from "./service.ts";
import { type TransactionMatchRow, transactionRow } from "./transactions.ts";

const ruleFields = [
  "account_id",
  "amount",
  "counterparty_iban",
  "counterparty_name",
  "description",
  "merchant",
] as const;
const ruleOperators = [
  "amount_between",
  "contains",
  "ends_with",
  "exact",
  "regex",
  "starts_with",
] as const;

type RuleRow = {
  category_id: string | null;
  category_name: string | null;
  field: (typeof ruleFields)[number];
  id: string;
  is_active: boolean;
  merchant_name: string | null;
  name: string;
  operator: (typeof ruleOperators)[number];
  pattern: string;
  priority: number;
  set_is_excluded_from_budget: boolean | null;
  set_is_fixed_cost: boolean | null;
  set_is_income: boolean | null;
  set_is_savings: boolean | null;
  set_is_transfer: boolean | null;
};

export async function listRules(pool: pg.Pool) {
  const categories = await listCategories(pool);
  const rows = await pool.query<RuleRow>(`
    SELECT
      categorization_rules.id,
      categorization_rules.name,
      categorization_rules.priority,
      categorization_rules.is_active,
      categorization_rules.field,
      categorization_rules.operator,
      categorization_rules.pattern,
      categories.id::text AS category_id,
      categories.name AS category_name,
      merchants.name AS merchant_name,
      categorization_rules.set_is_income,
      categorization_rules.set_is_transfer,
      categorization_rules.set_is_savings,
      categorization_rules.set_is_fixed_cost,
      categorization_rules.set_is_excluded_from_budget
    FROM categorization_rules
    LEFT JOIN categories ON categories.id = categorization_rules.category_id
    LEFT JOIN merchants ON merchants.id = categorization_rules.merchant_id
    ORDER BY categorization_rules.priority, categorization_rules.id
  `);
  const rules = await Promise.all(
    rows.rows.map(async (row) => {
      const preview = await previewStoredRule(pool, Number(row.id));
      return {
        alreadyCorrectCount: preview.alreadyCorrectCount,
        categoryId: row.category_id ? Number(row.category_id) : null,
        categoryName: row.category_name,
        field: row.field,
        flags: flags(row),
        id: Number(row.id),
        isActive: row.is_active,
        manualOverridesSkippedCount: preview.skippedManualCount,
        matchCount: preview.matchCount,
        merchantName: row.merchant_name,
        name: row.name,
        operator: row.operator,
        pattern: row.pattern,
        priority: row.priority,
        wouldChangeCount: preview.wouldChangeCount,
      };
    }),
  );
  return { categories, fields: ruleFields, operators: ruleOperators, rules };
}

export async function previewRule(pool: pg.Pool, rule: RulePreviewRequest) {
  const result = await matchingTransactions(pool, rule);
  return previewFromMatches(rule, result.rows);
}

export async function createRule(pool: pg.Pool, rule: RuleEditorRequest): Promise<number> {
  const merchantId = await upsertMerchant(pool, rule.merchantName, rule.categoryId);
  const result = await pool.query<{ id: string }>(
    toQuery(sql`
      INSERT INTO categorization_rules (
        name, priority, is_active, field, operator, pattern, category_id, merchant_id,
        set_is_income, set_is_transfer, set_is_savings, set_is_fixed_cost,
        set_is_excluded_from_budget
      )
      VALUES (
        ${rule.name}, ${rule.priority}, ${rule.isActive}, ${rule.field}, ${rule.operator},
        ${rule.pattern}, ${rule.categoryId}, ${merchantId}, ${flagValue(rule.flags.setIsIncome)},
        ${flagValue(rule.flags.setIsTransfer)}, ${flagValue(rule.flags.setIsSavings)},
        ${flagValue(rule.flags.setIsFixedCost)}, ${flagValue(rule.flags.setIsExcludedFromBudget)}
      )
      RETURNING id
    `),
  );
  return Number(result.rows[0]?.id);
}

export async function updateRule(
  pool: pg.Pool,
  ruleId: number,
  rule: RuleEditorRequest,
): Promise<void> {
  const merchantId = await upsertMerchant(pool, rule.merchantName, rule.categoryId);
  await pool.query(
    toQuery(sql`
      UPDATE categorization_rules
      SET
        name = ${rule.name},
        priority = ${rule.priority},
        is_active = ${rule.isActive},
        field = ${rule.field},
        operator = ${rule.operator},
        pattern = ${rule.pattern},
        category_id = ${rule.categoryId},
        merchant_id = ${merchantId},
        set_is_income = ${flagValue(rule.flags.setIsIncome)},
        set_is_transfer = ${flagValue(rule.flags.setIsTransfer)},
        set_is_savings = ${flagValue(rule.flags.setIsSavings)},
        set_is_fixed_cost = ${flagValue(rule.flags.setIsFixedCost)},
        set_is_excluded_from_budget = ${flagValue(rule.flags.setIsExcludedFromBudget)},
        updated_at = now()
      WHERE id = ${ruleId}
    `),
  );
}

export async function setRuleActive(
  pool: pg.Pool,
  ruleId: number,
  isActive: boolean,
): Promise<void> {
  await pool.query(
    toQuery(sql`
      UPDATE categorization_rules
      SET is_active = ${isActive}, updated_at = now()
      WHERE id = ${ruleId}
    `),
  );
}

export async function applyRule(pool: pg.Pool, ruleId: number) {
  const rule = await readRule(pool, ruleId);
  if (!rule.isActive) {
    return { skippedManualCount: 0, updatedCount: 0 };
  }
  const preview = await previewRule(pool, rule);
  if (preview.matches.length === 0) {
    return { skippedManualCount: preview.skippedManualCount, updatedCount: 0 };
  }
  await pool.query(
    `
      UPDATE enriched_transactions
      SET category_id = COALESCE($2::bigint, category_id),
          merchant_id = COALESCE($3::bigint, merchant_id),
          is_income = COALESCE($4::boolean, is_income),
          is_transfer = COALESCE($5::boolean, is_transfer),
          is_savings = COALESCE($6::boolean, is_savings),
          is_fixed_cost = COALESCE($7::boolean, is_fixed_cost),
          is_excluded_from_budget = COALESCE($8::boolean, is_excluded_from_budget),
          needs_review = false,
          classification_method = 'rule',
          classification_confidence = 1,
          classification_reason = $9,
          rule_id = $10,
          updated_at = now()
      WHERE id = ANY($1::bigint[])
        AND NOT EXISTS (
          SELECT 1 FROM manual_overrides
          WHERE manual_overrides.enriched_transaction_id = enriched_transactions.id
        )
    `,
    [
      preview.matches.map((match) => match.id),
      rule.categoryId,
      await merchantIdByName(pool, rule.merchantName),
      flagValue(rule.flags.setIsIncome),
      flagValue(rule.flags.setIsTransfer),
      flagValue(rule.flags.setIsSavings),
      flagValue(rule.flags.setIsFixedCost),
      flagValue(rule.flags.setIsExcludedFromBudget),
      `Backfilled from rule: ${rule.name}`,
      ruleId,
    ],
  );
  return { skippedManualCount: preview.skippedManualCount, updatedCount: preview.matches.length };
}

async function previewStoredRule(pool: pg.Pool, ruleId: number) {
  const rule = await readRule(pool, ruleId);
  const result = await matchingTransactions(pool, rule);
  return previewFromMatches(rule, result.rows);
}

async function readRule(
  pool: pg.Pool,
  ruleId: number,
): Promise<RulePreviewRequest & { isActive: boolean }> {
  const result = await pool.query<RuleRow>(
    `
      SELECT
        categorization_rules.id, categorization_rules.name, categorization_rules.priority,
        categorization_rules.is_active, categorization_rules.field, categorization_rules.operator,
        categorization_rules.pattern, categories.id::text AS category_id, categories.name AS category_name,
        merchants.name AS merchant_name, categorization_rules.set_is_income,
        categorization_rules.set_is_transfer, categorization_rules.set_is_savings,
        categorization_rules.set_is_fixed_cost, categorization_rules.set_is_excluded_from_budget
      FROM categorization_rules
      LEFT JOIN categories ON categories.id = categorization_rules.category_id
      LEFT JOIN merchants ON merchants.id = categorization_rules.merchant_id
      WHERE categorization_rules.id = $1
    `,
    [ruleId],
  );
  const row = result.rows[0];
  if (!row?.category_id) {
    throw new Error("Rule not found");
  }
  return {
    categoryId: Number(row.category_id),
    field: row.field,
    flags: {
      setIsExcludedFromBudget: row.set_is_excluded_from_budget === true,
      setIsFixedCost: row.set_is_fixed_cost === true,
      setIsIncome: row.set_is_income === true,
      setIsSavings: row.set_is_savings === true,
      setIsTransfer: row.set_is_transfer === true,
    },
    isActive: row.is_active,
    merchantName: row.merchant_name ?? undefined,
    name: row.name,
    operator: row.operator,
    pattern: row.pattern,
    priority: row.priority,
  };
}

function matchingTransactions(pool: pg.Pool, rule: RulePreviewRequest) {
  return pool.query<TransactionMatchRow>(
    `
      SELECT enriched_transactions.id, raw_transactions.booking_date::text,
        raw_transactions.amount::text, COALESCE(merchants.name, raw_transactions.counterparty_name, 'Unknown') AS merchant,
        raw_transactions.description, categories.id::text AS category_id, categories.name AS category_name,
        COALESCE(enriched_transactions.classification_method, 'none') AS classification_method,
        enriched_transactions.needs_review, enriched_transactions.is_income, enriched_transactions.is_transfer,
        enriched_transactions.is_savings, enriched_transactions.is_fixed_cost, enriched_transactions.is_recurring,
        enriched_transactions.is_one_off, enriched_transactions.is_excluded_from_budget,
        manual_overrides.id IS NOT NULL AS has_manual_override,
        categories.id::bigint = $4::bigint AS category_matches,
        COALESCE(merchants.name, '') = COALESCE($5::text, merchants.name, '') AS merchant_matches
      FROM enriched_transactions
      JOIN raw_transactions ON raw_transactions.id = enriched_transactions.raw_transaction_id
      LEFT JOIN merchants ON merchants.id = enriched_transactions.merchant_id
      LEFT JOIN categories ON categories.id = enriched_transactions.category_id
      LEFT JOIN manual_overrides ON manual_overrides.enriched_transaction_id = enriched_transactions.id
      WHERE (${matchCondition(rule)})
        AND ($2::numeric IS NULL OR true)
        AND ($3::numeric IS NULL OR true)
      ORDER BY raw_transactions.booking_date DESC, enriched_transactions.id DESC
    `,
    [
      rule.pattern,
      amountLower(rule.pattern),
      amountUpper(rule.pattern),
      rule.categoryId,
      rule.merchantName ?? null,
    ],
  );
}

function matchCondition(rule: RulePreviewRequest): string {
  if (rule.operator === "amount_between") {
    return rule.field === "amount" ? "raw_transactions.amount BETWEEN $2 AND $3" : "FALSE";
  }
  const field = fieldExpression(rule.field);
  switch (rule.operator) {
    case "contains":
      return `${field} ILIKE '%' || $1 || '%'`;
    case "ends_with":
      return `${field} ILIKE '%' || $1`;
    case "exact":
      return `lower(${field}) = lower($1)`;
    case "regex":
      return `${field} ~* $1`;
    case "starts_with":
      return `${field} ILIKE $1 || '%'`;
    default:
      return "FALSE";
  }
}

function fieldExpression(field: RulePreviewRequest["field"]): string {
  switch (field) {
    case "account_id":
      return "raw_transactions.account_id::text";
    case "counterparty_iban":
      return "COALESCE(raw_transactions.counterparty_iban, '')";
    case "counterparty_name":
      return "COALESCE(raw_transactions.counterparty_name, '')";
    case "description":
      return "raw_transactions.description";
    case "merchant":
      return "COALESCE(merchants.name, '')";
    case "amount":
      return "raw_transactions.amount::text";
  }
}

function amountLower(pattern: string): number | null {
  const [lower] = pattern.split("..");
  const parsed = Number(lower);
  return Number.isFinite(parsed) ? parsed : null;
}

function amountUpper(pattern: string): number | null {
  const upper = pattern.split("..")[1];
  const parsed = Number(upper);
  return Number.isFinite(parsed) ? parsed : null;
}

function previewFromMatches(rule: RulePreviewRequest, rows: TransactionMatchRow[]) {
  const skipped = rows.filter((row) => row.has_manual_override).length;
  const eligible = rows.filter((row) => !row.has_manual_override);
  const alreadyCorrect = eligible.filter((row) => alreadyCorrectForRule(rule, row)).length;
  const matches = eligible.filter((row) => !alreadyCorrectForRule(rule, row)).map(transactionRow);
  return {
    alreadyCorrectCount: alreadyCorrect,
    matchCount: rows.length,
    matches,
    skippedManualCount: skipped,
    wouldChangeCount: matches.length,
  };
}

function alreadyCorrectForRule(rule: RulePreviewRequest, row: TransactionMatchRow): boolean {
  return (
    row.category_matches &&
    row.merchant_matches &&
    (!rule.flags.setIsIncome || row.is_income) &&
    (!rule.flags.setIsTransfer || row.is_transfer) &&
    (!rule.flags.setIsSavings || row.is_savings) &&
    (!rule.flags.setIsFixedCost || row.is_fixed_cost) &&
    (!rule.flags.setIsExcludedFromBudget || row.is_excluded_from_budget)
  );
}

async function upsertMerchant(
  pool: pg.Pool,
  merchantName: string | undefined,
  categoryId: number,
): Promise<number | null> {
  const cleaned = merchantName?.trim();
  if (!cleaned) {
    return null;
  }
  const result = await pool.query<{ id: string }>(
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

async function merchantIdByName(
  pool: pg.Pool,
  merchantName: string | undefined,
): Promise<number | null> {
  if (!merchantName?.trim()) {
    return null;
  }
  const result = await pool.query<{ id: string }>("SELECT id FROM merchants WHERE name = $1", [
    merchantName.trim(),
  ]);
  return result.rows[0] ? Number(result.rows[0].id) : null;
}

function flagValue(enabled: boolean): boolean | null {
  return enabled ? true : null;
}

function flags(row: RuleRow): string[] {
  return [
    row.set_is_income ? "income" : null,
    row.set_is_transfer ? "transfer" : null,
    row.set_is_savings ? "savings" : null,
    row.set_is_fixed_cost ? "fixed" : null,
    row.set_is_excluded_from_budget ? "excluded" : null,
  ].filter((flag): flag is string => flag !== null);
}
