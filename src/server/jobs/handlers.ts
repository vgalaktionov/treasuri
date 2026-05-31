import type pg from "pg";

import { createDefaultBankProvider } from "../bank/fake.ts";
import { syncBankTransactions } from "../bank/sync.ts";
import { classifyPendingTransactions } from "../classify/service.ts";
import { calculateSafeToSpend, daysLeftInMonth, formatMoney } from "../forecast/calculator.ts";
import { applyRule } from "../management/rules.ts";
import { createXlsxExport } from "../operations/exportService.ts";
import { normalizePendingTransactions } from "../transactions/normalize.ts";
import { type JobName, jobPayloadSchemas } from "./definitions.ts";

export const registeredJobs = Object.keys(jobPayloadSchemas) as JobName[];

export async function runJob(pool: pg.Pool, name: JobName, payload: unknown) {
  switch (name) {
    case "sync_abn_transactions":
      jobPayloadSchemas.sync_abn_transactions.parse(payload);
      return syncBankTransactions(pool, createDefaultBankProvider());
    case "normalize_transactions":
      jobPayloadSchemas.normalize_transactions.parse(payload);
      return normalizeTransactions(pool);
    case "classify_transactions":
      jobPayloadSchemas.classify_transactions.parse(payload);
      return classifyPendingTransactions(pool);
    case "detect_recurring":
      jobPayloadSchemas.detect_recurring.parse(payload);
      return detectRecurringCandidates(pool);
    case "update_monthly_forecast":
      jobPayloadSchemas.update_monthly_forecast.parse(payload);
      return updateMonthlyForecast(pool);
    case "generate_xlsx_export": {
      const parsed = jobPayloadSchemas.generate_xlsx_export.parse(payload);
      return createXlsxExport(pool, parsed.createdBy ?? null);
    }
    case "backfill_rule": {
      const parsed = jobPayloadSchemas.backfill_rule.parse(payload);
      return applyRule(pool, parsed.ruleId);
    }
  }
}

async function normalizeTransactions(pool: pg.Pool) {
  const client = await pool.connect();
  try {
    return { normalizedCount: await normalizePendingTransactions(client) };
  } finally {
    client.release();
  }
}

async function detectRecurringCandidates(pool: pg.Pool) {
  const result = await pool.query<{ id: string }>(`
    INSERT INTO recurring_series (
      merchant_id, category_id, name, cadence, amount_mode, expected_amount,
      confidence, is_confirmed, next_expected_date
    )
    SELECT
      enriched_transactions.merchant_id,
      enriched_transactions.category_id,
      COALESCE(merchants.name, raw_transactions.counterparty_name, 'Recurring candidate'),
      'monthly',
      'fixed',
      round(avg(abs(raw_transactions.amount)), 2),
      0.6,
      false,
      (date_trunc('month', max(raw_transactions.booking_date)) + interval '1 month')::date
    FROM enriched_transactions
    JOIN raw_transactions ON raw_transactions.id = enriched_transactions.raw_transaction_id
    LEFT JOIN merchants ON merchants.id = enriched_transactions.merchant_id
    WHERE raw_transactions.amount < 0
    GROUP BY enriched_transactions.merchant_id, enriched_transactions.category_id, merchants.name,
      raw_transactions.counterparty_name
    HAVING count(*) >= 2
      AND NOT EXISTS (
        SELECT 1 FROM recurring_series
        WHERE recurring_series.name = COALESCE(merchants.name, raw_transactions.counterparty_name, 'Recurring candidate')
      )
    RETURNING id
  `);
  return { recurringCount: result.rowCount ?? 0 };
}

async function updateMonthlyForecast(pool: pg.Pool, asOf = new Date()) {
  const yearMonth = asOf.toISOString().slice(0, 7);
  const [balance, settings, totals] = await Promise.all([
    latestBalance(pool),
    forecastSettings(pool),
    monthlyTotals(pool, yearMonth),
  ]);
  const calculated = calculateSafeToSpend({
    currentLiquidBalance: balance,
    daysLeftInMonth: daysLeftInMonth(asOf),
    expectedIncomeRemaining: "0.00",
    fixedCostsUpcoming: totals.fixedCostsUpcoming,
    predictedVariableRemaining: totals.predictedVariableRemaining,
    safetyBuffer: settings.safetyBuffer,
    targetSavingsRemaining: settings.targetSavings,
  });

  await pool.query(
    `
      INSERT INTO monthly_forecasts (
        year_month, income_received, expected_income_remaining, fixed_costs_paid,
        fixed_costs_upcoming, variable_spent, predicted_variable_remaining, target_savings,
        safety_buffer, safe_to_spend, safe_per_day, projected_savings, confidence,
        explanation_json
      )
      VALUES ($1, $2, 0, 0, $3, $4, $5, $6, $7, $8, $9, $10, 'medium', $11::jsonb)
      ON CONFLICT (year_month) DO UPDATE SET
        income_received = EXCLUDED.income_received,
        fixed_costs_upcoming = EXCLUDED.fixed_costs_upcoming,
        variable_spent = EXCLUDED.variable_spent,
        predicted_variable_remaining = EXCLUDED.predicted_variable_remaining,
        target_savings = EXCLUDED.target_savings,
        safety_buffer = EXCLUDED.safety_buffer,
        safe_to_spend = EXCLUDED.safe_to_spend,
        safe_per_day = EXCLUDED.safe_per_day,
        projected_savings = EXCLUDED.projected_savings,
        confidence = EXCLUDED.confidence,
        explanation_json = EXCLUDED.explanation_json,
        updated_at = now()
    `,
    [
      yearMonth,
      totals.incomeReceived,
      totals.fixedCostsUpcoming,
      totals.variableSpent,
      totals.predictedVariableRemaining,
      settings.targetSavings,
      settings.safetyBuffer,
      calculated.safeToSpend,
      calculated.safePerDay,
      formatMoney(Number(calculated.safeToSpend) + Number(settings.targetSavings)),
      JSON.stringify(calculated.explanation),
    ],
  );
  return { yearMonth };
}

async function latestBalance(pool: pg.Pool): Promise<string> {
  const result = await pool.query<{ balance: string }>(
    "SELECT balance::text FROM account_balance_snapshots ORDER BY as_of DESC, id DESC LIMIT 1",
  );
  return result.rows[0]?.balance ?? "0.00";
}

async function forecastSettings(pool: pg.Pool) {
  const result = await pool.query<{ key: string; value_json: { amount?: string } }>(
    "SELECT key, value_json FROM app_settings WHERE key IN ('target_monthly_savings', 'safety_buffer')",
  );
  const values = new Map(result.rows.map((row) => [row.key, row.value_json.amount ?? "0.00"]));
  return {
    safetyBuffer: values.get("safety_buffer") ?? "1000.00",
    targetSavings: values.get("target_monthly_savings") ?? "1000.00",
  };
}

async function monthlyTotals(pool: pg.Pool, yearMonth: string) {
  const result = await pool.query<{
    fixed_costs_upcoming: string;
    income_received: string;
    predicted_variable_remaining: string;
    variable_spent: string;
  }>(
    `
      SELECT
        COALESCE(sum(raw_transactions.amount) FILTER (WHERE raw_transactions.amount > 0), 0)::text
          AS income_received,
        COALESCE(sum(abs(raw_transactions.amount)) FILTER (
          WHERE raw_transactions.amount < 0 AND enriched_transactions.is_fixed_cost = true
        ), 0)::text AS fixed_costs_upcoming,
        COALESCE(sum(abs(raw_transactions.amount)) FILTER (
          WHERE raw_transactions.amount < 0 AND enriched_transactions.is_fixed_cost = false
        ), 0)::text AS variable_spent,
        COALESCE(sum(abs(raw_transactions.amount)) FILTER (
          WHERE raw_transactions.amount < 0 AND enriched_transactions.is_fixed_cost = false
        ), 0)::text AS predicted_variable_remaining
      FROM enriched_transactions
      JOIN raw_transactions ON raw_transactions.id = enriched_transactions.raw_transaction_id
      WHERE to_char(raw_transactions.booking_date, 'YYYY-MM') = $1
    `,
    [yearMonth],
  );
  const row = result.rows[0];
  if (!row) {
    return emptyTotals();
  }
  return {
    fixedCostsUpcoming: row.fixed_costs_upcoming,
    incomeReceived: row.income_received,
    predictedVariableRemaining: row.predicted_variable_remaining,
    variableSpent: row.variable_spent,
  };
}

function emptyTotals() {
  return {
    fixedCostsUpcoming: "0.00",
    incomeReceived: "0.00",
    predictedVariableRemaining: "0.00",
    variableSpent: "0.00",
  };
}
