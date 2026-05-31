import type pg from "pg";

import {
  calculateSafeToSpend,
  daysInMonth,
  daysLeftInMonth,
  formatMoney,
  predictVariableSpend,
} from "./calculator.ts";

const staleSyncAfterDays = 2;

export async function updateMonthlyForecast(pool: pg.Pool, asOf = new Date()) {
  const yearMonth = asOf.toISOString().slice(0, 7);
  const [balance, settings, totals, fixedCostsUpcoming, reviewCount, lastCompletedSyncAt] =
    await Promise.all([
      latestBalance(pool),
      forecastSettings(pool),
      monthlyTotals(pool, yearMonth),
      fixedCostsUpcomingTotal(pool, asOf),
      openReviewCount(pool),
      lastCompletedSyncFinishedAt(pool),
    ]);
  const elapsedDays = Math.min(asOf.getUTCDate(), daysInMonth(asOf));
  const variablePrediction = predictVariableSpend({
    baseline3m: settings.variableBaseline3m,
    baseline6m: settings.variableBaseline6m,
    currentSpend: totals.variableSpent,
    daysInMonth: daysInMonth(asOf),
    elapsedDays,
  });
  const calculated = calculateSafeToSpend({
    currentLiquidBalance: balance,
    daysLeftInMonth: daysLeftInMonth(asOf),
    expectedIncomeRemaining: "0.00",
    fixedCostsUpcoming,
    predictedVariableRemaining: variablePrediction.predictedRemaining,
    safetyBuffer: settings.safetyBuffer,
    targetSavingsRemaining: settings.targetSavings,
  });
  const confidence = forecastConfidence(reviewCount, lastCompletedSyncAt, asOf);
  const explanation = {
    ...calculated.explanation,
    confidence_reasons: confidence.reasons.join(","),
    fixed_costs_paid: formatMoney(totals.fixedCostsPaid),
    income_received: formatMoney(totals.incomeReceived),
    last_completed_sync_at: lastCompletedSyncAt?.toISOString() ?? "",
    pace_projection: variablePrediction.paceProjection,
    predicted_month_end: variablePrediction.predictedMonthEnd,
    review_count: String(reviewCount),
    stale_sync_after_days: String(staleSyncAfterDays),
    variable_baseline_3m: formatMoney(settings.variableBaseline3m),
    variable_baseline_6m: formatMoney(settings.variableBaseline6m),
    variable_spent: formatMoney(totals.variableSpent),
  };

  await pool.query(
    `
      INSERT INTO monthly_forecasts (
        year_month, income_received, expected_income_remaining, fixed_costs_paid,
        fixed_costs_upcoming, variable_spent, predicted_variable_remaining, target_savings,
        safety_buffer, safe_to_spend, safe_per_day, projected_savings, confidence,
        explanation_json
      )
      VALUES ($1, $2, 0, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb)
      ON CONFLICT (year_month) DO UPDATE SET
        income_received = EXCLUDED.income_received,
        expected_income_remaining = EXCLUDED.expected_income_remaining,
        fixed_costs_paid = EXCLUDED.fixed_costs_paid,
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
      totals.fixedCostsPaid,
      fixedCostsUpcoming,
      totals.variableSpent,
      variablePrediction.predictedRemaining,
      settings.targetSavings,
      settings.safetyBuffer,
      calculated.safeToSpend,
      calculated.safePerDay,
      formatMoney(Number(calculated.safeToSpend) + Number(settings.targetSavings)),
      confidence.level,
      JSON.stringify(explanation),
    ],
  );
  return { confidence: confidence.level, reviewCount, yearMonth };
}

async function latestBalance(pool: pg.Pool): Promise<string> {
  const result = await pool.query<{ balance: string }>(
    "SELECT balance::text FROM account_balance_snapshots ORDER BY as_of DESC, id DESC LIMIT 1",
  );
  return result.rows[0]?.balance ?? "0.00";
}

async function forecastSettings(pool: pg.Pool) {
  const result = await pool.query<{ key: string; value_json: unknown }>(
    `
      SELECT key, value_json
      FROM app_settings
      WHERE key IN (
        'target_monthly_savings', 'safety_buffer', 'variable_baseline_3m',
        'variable_baseline_6m'
      )
    `,
  );
  const values = new Map(result.rows.map((row) => [row.key, readSettingAmount(row.value_json)]));
  return {
    safetyBuffer: values.get("safety_buffer") ?? "1000.00",
    targetSavings: values.get("target_monthly_savings") ?? "1000.00",
    variableBaseline3m: values.get("variable_baseline_3m") ?? "0.00",
    variableBaseline6m: values.get("variable_baseline_6m") ?? "0.00",
  };
}

async function monthlyTotals(pool: pg.Pool, yearMonth: string) {
  const result = await pool.query<{
    fixed_costs_paid: string;
    income_received: string;
    variable_spent: string;
  }>(
    `
      SELECT
        COALESCE(sum(raw_transactions.amount) FILTER (
          WHERE enriched_transactions.is_income = true
        ), 0)::text
          AS income_received,
        COALESCE(sum(abs(raw_transactions.amount)) FILTER (
          WHERE raw_transactions.amount < 0 AND enriched_transactions.is_fixed_cost = true
        ), 0)::text AS fixed_costs_paid,
        COALESCE(sum(abs(raw_transactions.amount)) FILTER (
          WHERE raw_transactions.amount < 0
            AND enriched_transactions.is_variable_cost = true
            AND enriched_transactions.is_income = false
            AND enriched_transactions.is_transfer = false
            AND enriched_transactions.is_excluded_from_budget = false
        ), 0)::text AS variable_spent
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
    fixedCostsPaid: row.fixed_costs_paid,
    incomeReceived: row.income_received,
    variableSpent: row.variable_spent,
  };
}

function emptyTotals() {
  return {
    fixedCostsPaid: "0.00",
    incomeReceived: "0.00",
    variableSpent: "0.00",
  };
}

async function fixedCostsUpcomingTotal(pool: pg.Pool, asOf: Date): Promise<string> {
  const result = await pool.query<{ total: string }>(
    `
      SELECT COALESCE(sum(expected_amount), 0)::text AS total
      FROM recurring_series
      WHERE is_active = true
        AND is_confirmed = true
        AND expected_amount IS NOT NULL
        AND next_expected_date BETWEEN $1::date AND $2::date
    `,
    [isoDate(asOf), monthEndIsoDate(asOf)],
  );
  const recurringTotal = Number(result.rows[0]?.total ?? 0);
  const settings = await pool.query<{ value_json: unknown }>(
    "SELECT value_json FROM app_settings WHERE key = 'fixed_costs_upcoming'",
  );
  const manualTotal = Number(readSettingAmount(settings.rows[0]?.value_json));
  return formatMoney(recurringTotal + manualTotal);
}

async function openReviewCount(pool: pg.Pool): Promise<number> {
  const result = await pool.query<{ count: string }>(
    "SELECT count(*)::text FROM enriched_transactions WHERE needs_review = true",
  );
  return Number(result.rows[0]?.count ?? 0);
}

async function lastCompletedSyncFinishedAt(pool: pg.Pool): Promise<Date | null> {
  const result = await pool.query<{ finished_at: Date | null }>(`
    SELECT finished_at
    FROM sync_runs
    WHERE status = 'completed'
      AND finished_at IS NOT NULL
    ORDER BY finished_at DESC, id DESC
    LIMIT 1
  `);
  return result.rows[0]?.finished_at ?? null;
}

function forecastConfidence(
  reviewCount: number,
  lastCompletedSyncAt: Date | null,
  asOf: Date,
): { level: "low" | "medium"; reasons: string[] } {
  const reasons: string[] = [];
  if (reviewCount > 0) {
    reasons.push("review_burden");
  }
  if (!lastCompletedSyncAt) {
    reasons.push("no_completed_sync");
  } else if (syncAgeDays(lastCompletedSyncAt, asOf) > staleSyncAfterDays) {
    reasons.push("sync_stale");
  }
  return reasons.length > 0 ? { level: "low", reasons } : { level: "medium", reasons };
}

function syncAgeDays(finishedAt: Date, asOf: Date): number {
  const syncDate = Date.UTC(
    finishedAt.getUTCFullYear(),
    finishedAt.getUTCMonth(),
    finishedAt.getUTCDate(),
  );
  const forecastDate = Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate());
  return Math.max(0, Math.floor((forecastDate - syncDate) / 86_400_000));
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function monthEndIsoDate(date: Date): string {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0))
    .toISOString()
    .slice(0, 10);
}

function readSettingAmount(value: unknown): string {
  if (value && typeof value === "object" && "amount" in value) {
    return String((value as { amount?: unknown }).amount ?? "0.00");
  }
  if (typeof value === "number" || typeof value === "string") {
    return String(value);
  }
  return "0.00";
}
