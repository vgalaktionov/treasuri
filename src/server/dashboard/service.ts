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
  const uncategorized = await readUncategorizedImpact(pool, forecast.year_month);
  const projectedSavings = formatMoney(
    Number(calculated.safeToSpend) + Number(forecast.target_savings),
  );
  const explanation = {
    ...normalizeExplanation(forecast.explanation_json),
    ...calculated.explanation,
  };
  const fixedCostsTotal = formatMoney(
    Number(forecast.fixed_costs_paid) + Number(forecast.fixed_costs_upcoming),
  );

  return {
    categoryPace: await readCategoryPace(pool, forecast.year_month),
    confidence: forecast.confidence,
    confidenceNote: confidenceNote(forecast.confidence, review.count),
    currentBalance: balance,
    explanation,
    fixedCostsUpcoming: formatMoney(forecast.fixed_costs_upcoming),
    incomeReceived: formatMoney(forecast.income_received),
    metrics: [
      { label: "Safe to spend", value: `EUR ${calculated.safeToSpend}` },
      { label: "Safe per day", value: `EUR ${calculated.safePerDay}/day` },
      { label: "Projected savings", value: `EUR ${projectedSavings}` },
      { label: "Needs review", value: String(review.count) },
    ],
    monthFacts: [
      {
        detail: `EUR ${formatMoney(forecast.fixed_costs_paid)} paid, EUR ${formatMoney(forecast.fixed_costs_upcoming)} upcoming`,
        label: "Fixed costs",
        value: `EUR ${fixedCostsTotal}`,
      },
      {
        detail: `EUR ${formatMoney(forecast.income_received)} received, EUR ${formatMoney(forecast.expected_income_remaining)} expected`,
        label: "Income status",
        value: incomeStatus(forecast.income_received, forecast.expected_income_remaining),
      },
      {
        detail: `${uncategorized.count} ${uncategorized.count === 1 ? "transaction" : "transactions"} still need review`,
        label: "Uncategorized impact",
        value: `EUR ${formatMoney(uncategorized.amount)}`,
      },
    ],
    paceSummary: paceSummary(explanation),
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
    categoryPace: [
      {
        category: "Groceries",
        currentMonth: "64.35",
        paceLabel: "Within current month budget",
        status: "ok",
        suggestedBudget: "420.00",
      },
      {
        category: "Dog",
        currentMonth: "89.95",
        paceLabel: "Watch this category",
        status: "watch",
        suggestedBudget: "100.00",
      },
    ],
    confidence: "medium",
    confidenceNote: "Review needed",
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
    monthFacts: [
      {
        detail: "EUR 1450.00 paid, EUR 620.00 upcoming",
        label: "Fixed costs",
        value: "EUR 2070.00",
      },
      {
        detail: "EUR 5258.00 received, EUR 0.00 expected",
        label: "Income status",
        value: "Income received",
      },
      {
        detail: "1 transaction still needs review",
        label: "Uncategorized impact",
        value: "EUR 42.10",
      },
    ],
    paceSummary: "Variable pace is tracking the sample forecast.",
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
    explanation_json: unknown;
    fixed_costs_paid: string;
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
      fixed_costs_paid::text,
      fixed_costs_upcoming::text,
      predicted_variable_remaining::text,
      target_savings::text,
      safety_buffer::text,
      confidence,
      explanation_json
    FROM monthly_forecasts
    ORDER BY year_month DESC
    LIMIT 1
  `);
  return result.rows[0] ?? null;
}

function normalizeExplanation(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object") {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value)
      .filter((entry): entry is [string, string | number | boolean] =>
        ["boolean", "number", "string"].includes(typeof entry[1]),
      )
      .map(([key, entryValue]) => [key, String(entryValue)]),
  );
}

async function readUncategorizedImpact(
  pool: pg.Pool,
  yearMonth: string,
): Promise<{ amount: string; count: number }> {
  const result = await pool.query<{ amount: string | null; count: string }>(
    `
      SELECT count(*)::text, COALESCE(sum(abs(raw_transactions.amount)), 0)::text AS amount
      FROM enriched_transactions
      JOIN raw_transactions ON raw_transactions.id = enriched_transactions.raw_transaction_id
      LEFT JOIN categories ON categories.id = enriched_transactions.category_id
      WHERE to_char(raw_transactions.booking_date, 'YYYY-MM') = $1
        AND raw_transactions.amount < 0
        AND enriched_transactions.is_income = false
        AND enriched_transactions.is_transfer = false
        AND (
          enriched_transactions.needs_review = true
          OR categories.name IS NULL
          OR categories.name = 'Unknown'
        )
    `,
    [yearMonth],
  );
  return { amount: result.rows[0]?.amount ?? "0.00", count: Number(result.rows[0]?.count ?? 0) };
}

async function readCategoryPace(pool: pg.Pool, yearMonth: string) {
  const result = await pool.query<{
    average_prior_months: string;
    category: string;
    current_month: string;
  }>(
    `
      WITH category_months AS (
        SELECT
          categories.name AS category,
          to_char(raw_transactions.booking_date, 'YYYY-MM') AS year_month,
          sum(abs(raw_transactions.amount)) AS amount
        FROM enriched_transactions
        JOIN raw_transactions ON raw_transactions.id = enriched_transactions.raw_transaction_id
        JOIN categories ON categories.id = enriched_transactions.category_id
        WHERE raw_transactions.amount < 0
          AND enriched_transactions.is_income = false
          AND enriched_transactions.is_transfer = false
          AND enriched_transactions.is_savings = false
          AND enriched_transactions.is_excluded_from_budget = false
        GROUP BY categories.name, to_char(raw_transactions.booking_date, 'YYYY-MM')
      )
      SELECT
        current.category,
        current.amount::text AS current_month,
        COALESCE(avg(history.amount), current.amount, 0)::text AS average_prior_months
      FROM category_months AS current
      LEFT JOIN category_months AS history
        ON history.category = current.category
       AND history.year_month < current.year_month
      WHERE current.year_month = $1
      GROUP BY current.category, current.amount
      ORDER BY current.amount DESC
      LIMIT 8
    `,
    [yearMonth],
  );
  return result.rows.map((row) => {
    const current = Number(row.current_month);
    const suggested = Math.max(Number(row.average_prior_months), current);
    return {
      category: row.category,
      currentMonth: formatMoney(row.current_month),
      paceLabel: categoryPaceLabel(current, suggested),
      status: categoryPaceStatus(current, suggested),
      suggestedBudget: formatMoney(String(suggested)),
    };
  });
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

function incomeStatus(incomeReceived: string, expectedIncomeRemaining: string): string {
  const received = Number(incomeReceived);
  const expected = Number(expectedIncomeRemaining);
  if (received > 0 && expected <= 0) {
    return "Income received";
  }
  if (received > 0) {
    return "Income partly received";
  }
  if (expected > 0) {
    return "Income expected";
  }
  return "No income seen yet";
}

function confidenceNote(confidence: string, reviewCount: number): string {
  if (reviewCount > 0) {
    return "Review needed";
  }
  if (confidence === "low") {
    return "Forecast needs more history";
  }
  return "Recent sync and no review blockers";
}

function paceSummary(explanation: Record<string, string>): string {
  const paceProjection = explanation.pace_projection;
  if (paceProjection) {
    return `Variable pace projects EUR ${formatMoney(paceProjection)} this month`;
  }
  return "Variable pace uses current month spend and configured forecast assumptions.";
}

function categoryPaceStatus(current: number, suggested: number): "empty" | "ok" | "over" | "watch" {
  if (suggested <= 0) {
    return "empty";
  }
  if (current > suggested) {
    return "over";
  }
  if (current >= suggested * 0.8) {
    return "watch";
  }
  return "ok";
}

function categoryPaceLabel(current: number, suggested: number): string {
  const status = categoryPaceStatus(current, suggested);
  if (status === "over") {
    return "Over usual pace";
  }
  if (status === "watch") {
    return "Close to usual pace";
  }
  if (status === "empty") {
    return "No budget baseline";
  }
  return "Within usual pace";
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
