import type pg from "pg";

import type { DashboardResponse } from "../../shared/dashboard.ts";
import { calculateSafeToSpend, daysLeftInMonth, formatMoney } from "../forecast/calculator.ts";

export async function loadDashboard(pool: pg.Pool, asOf = new Date()): Promise<DashboardResponse> {
  const forecast = await readLatestForecast(pool);
  const balance = await readCurrentBalance(pool);
  if (!forecast || !balance) {
    return sampleDashboard();
  }

  const calculated = calculateSafeToSpend({
    currentLiquidBalance: balance.amount,
    daysLeftInMonth: daysLeftInMonth(asOf),
    expectedIncomeRemaining: forecast.expected_income_remaining,
    fixedCostsUpcoming: forecast.fixed_costs_upcoming,
    predictedVariableRemaining: forecast.predicted_variable_remaining,
    safetyBuffer: forecast.safety_buffer,
    targetSavingsRemaining: forecast.target_savings,
  });
  const review = await readReviewImpact(pool, forecast.year_month);
  const projectedSavings = formatMoney(
    Number(calculated.safeToSpend) + Number(forecast.target_savings),
  );

  return {
    confidence: forecast.confidence,
    currentBalance: balance,
    explanation: calculated.explanation,
    fixedCostsUpcoming: formatMoney(forecast.fixed_costs_upcoming),
    incomeReceived: formatMoney(forecast.income_received),
    metrics: [
      { label: "Safe to spend", value: `EUR ${calculated.safeToSpend}` },
      { label: "Safe per day", value: `EUR ${calculated.safePerDay}/day` },
      { label: "Projected savings", value: `EUR ${projectedSavings}` },
      { label: "Needs review", value: String(review.count) },
    ],
    projectedSavings,
    reviewCount: review.count,
    reviewImpact: formatMoney(review.amount),
    safePerDay: calculated.safePerDay,
    safeToSpend: calculated.safeToSpend,
    topVariances: await readTopCategorySpend(pool, forecast.year_month),
    upcomingFixedCosts: await readUpcomingFixedCosts(pool),
    yearMonth: forecast.year_month,
  };
}

export function sampleDashboard(): DashboardResponse {
  return {
    confidence: "medium",
    currentBalance: {
      amount: "3478.45",
      asOf: "2026-05-28 08:00:00+00",
      currency: "EUR",
      source: "sample",
    },
    explanation: {
      days_left_in_month: "6",
      formula:
        "synced_current_liquid_balance + expected_income_remaining - fixed_costs_upcoming - predicted_variable_remaining - target_savings_remaining - safety_buffer",
      synced_current_liquid_balance: "3478.45",
    },
    fixedCostsUpcoming: "620.00",
    incomeReceived: "5258.00",
    metrics: [
      { label: "Safe to spend", value: "EUR 98.45" },
      { label: "Safe per day", value: "EUR 16.41/day" },
      { label: "Projected savings", value: "EUR 1098.45" },
      { label: "Needs review", value: "1" },
    ],
    projectedSavings: "1098.45",
    reviewCount: 1,
    reviewImpact: "42.10",
    safePerDay: "16.41",
    safeToSpend: "98.45",
    topVariances: [
      { label: "One-off / Large purchase", value: "EUR 320.00" },
      { label: "Dog", value: "EUR 89.95" },
    ],
    upcomingFixedCosts: [{ label: "Sample Rent", value: "EUR 1450.00 on 2026-06-01" }],
    yearMonth: "2026-05",
  };
}

async function readLatestForecast(pool: pg.Pool) {
  const result = await pool.query<{
    confidence: string;
    expected_income_remaining: string;
    fixed_costs_upcoming: string;
    income_received: string;
    predicted_variable_remaining: string;
    safety_buffer: string;
    target_savings: string;
    year_month: string;
  }>(`
    SELECT
      year_month,
      income_received::text,
      expected_income_remaining::text,
      fixed_costs_upcoming::text,
      predicted_variable_remaining::text,
      target_savings::text,
      safety_buffer::text,
      confidence
    FROM monthly_forecasts
    ORDER BY year_month DESC
    LIMIT 1
  `);
  return result.rows[0] ?? null;
}

async function readCurrentBalance(pool: pg.Pool) {
  const result = await pool.query<{
    amount: string;
    as_of: string;
    currency: string;
    source: string;
  }>(`
    SELECT balance::text AS amount, currency, source, as_of::text
    FROM account_balance_snapshots
    ORDER BY as_of DESC, id DESC
    LIMIT 1
  `);
  const row = result.rows[0];
  return row
    ? { amount: row.amount, asOf: row.as_of, currency: row.currency, source: row.source }
    : null;
}

async function readReviewImpact(
  pool: pg.Pool,
  yearMonth: string,
): Promise<{ amount: string; count: number }> {
  const result = await pool.query<{ amount: string | null; count: string }>(
    `
      SELECT count(*)::text, COALESCE(sum(abs(raw_transactions.amount)), 0)::text AS amount
      FROM enriched_transactions
      JOIN raw_transactions ON raw_transactions.id = enriched_transactions.raw_transaction_id
      WHERE enriched_transactions.needs_review = true
        AND to_char(raw_transactions.booking_date, 'YYYY-MM') = $1
    `,
    [yearMonth],
  );
  return { amount: result.rows[0]?.amount ?? "0.00", count: Number(result.rows[0]?.count ?? 0) };
}

async function readTopCategorySpend(pool: pg.Pool, yearMonth: string) {
  const result = await pool.query<{ amount: string; category: string }>(
    `
      SELECT categories.name AS category, abs(sum(raw_transactions.amount))::text AS amount
      FROM enriched_transactions
      JOIN raw_transactions ON raw_transactions.id = enriched_transactions.raw_transaction_id
      JOIN categories ON categories.id = enriched_transactions.category_id
      WHERE raw_transactions.amount < 0
        AND enriched_transactions.is_excluded_from_budget = false
        AND to_char(raw_transactions.booking_date, 'YYYY-MM') = $1
      GROUP BY categories.name
      ORDER BY abs(sum(raw_transactions.amount)) DESC
      LIMIT 3
    `,
    [yearMonth],
  );
  return result.rows.map((row) => ({
    label: row.category,
    value: `EUR ${formatMoney(row.amount)}`,
  }));
}

async function readUpcomingFixedCosts(pool: pg.Pool) {
  const result = await pool.query<{
    expected_amount: string | null;
    name: string;
    next_expected_date: string;
  }>(`
    SELECT name, expected_amount::text, next_expected_date::text
    FROM recurring_series
    WHERE is_active = true
      AND is_confirmed = true
      AND next_expected_date IS NOT NULL
    ORDER BY next_expected_date ASC
    LIMIT 3
  `);
  return result.rows.map((row) => ({
    label: row.name,
    value: `EUR ${formatMoney(row.expected_amount ?? "0")} on ${row.next_expected_date}`,
  }));
}
