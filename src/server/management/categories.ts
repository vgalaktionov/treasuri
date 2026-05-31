import type pg from "pg";

import type { CategoryBudgetResponse } from "../../shared/management.ts";

const forecastExcludedCategories = new Set([
  "Income",
  "Transfers",
  "Savings",
  "One-off / Large purchase",
  "Unknown",
]);

type CategoryBudgetRow = {
  current_month: string;
  excluded_from_forecast: string;
  id: string;
  name: string;
  prior_12m: string;
  prior_3m: string;
  prior_6m: string;
};

export async function listCategories(pool: pg.Pool) {
  const result = await pool.query<{ id: string; name: string }>(
    "SELECT id, name FROM categories ORDER BY name",
  );
  return result.rows.map((row) => ({ id: Number(row.id), name: row.name }));
}

export async function listCategoryBudgets(pool: pg.Pool): Promise<CategoryBudgetResponse> {
  const result = await pool.query<CategoryBudgetRow & { year_month: string }>(`
    WITH selected_month AS (
      SELECT COALESCE(
        (SELECT year_month FROM monthly_forecasts ORDER BY year_month DESC LIMIT 1),
        to_char(current_date, 'YYYY-MM')
      ) AS year_month
    ),
    bounds AS (
      SELECT
        year_month,
        to_date(year_month || '-01', 'YYYY-MM-DD') AS month_start
      FROM selected_month
    )
    SELECT
      categories.id::text,
      categories.name,
      bounds.year_month,
      COALESCE(sum(abs(raw_transactions.amount)) FILTER (
        WHERE raw_transactions.booking_date >= bounds.month_start
          AND raw_transactions.booking_date < bounds.month_start + interval '1 month'
          AND enriched_transactions.is_income = false
          AND enriched_transactions.is_transfer = false
          AND enriched_transactions.is_savings = false
          AND enriched_transactions.is_excluded_from_budget = false
      ), 0)::text AS current_month,
      COALESCE(sum(abs(raw_transactions.amount)) FILTER (
        WHERE raw_transactions.booking_date >= bounds.month_start - interval '3 months'
          AND raw_transactions.booking_date < bounds.month_start
          AND enriched_transactions.is_income = false
          AND enriched_transactions.is_transfer = false
          AND enriched_transactions.is_savings = false
          AND enriched_transactions.is_excluded_from_budget = false
      ), 0)::text AS prior_3m,
      COALESCE(sum(abs(raw_transactions.amount)) FILTER (
        WHERE raw_transactions.booking_date >= bounds.month_start - interval '6 months'
          AND raw_transactions.booking_date < bounds.month_start
          AND enriched_transactions.is_income = false
          AND enriched_transactions.is_transfer = false
          AND enriched_transactions.is_savings = false
          AND enriched_transactions.is_excluded_from_budget = false
      ), 0)::text AS prior_6m,
      COALESCE(sum(abs(raw_transactions.amount)) FILTER (
        WHERE raw_transactions.booking_date >= bounds.month_start - interval '12 months'
          AND raw_transactions.booking_date < bounds.month_start
          AND enriched_transactions.is_income = false
          AND enriched_transactions.is_transfer = false
          AND enriched_transactions.is_savings = false
          AND enriched_transactions.is_excluded_from_budget = false
      ), 0)::text AS prior_12m,
      COALESCE(sum(abs(raw_transactions.amount)) FILTER (
        WHERE raw_transactions.booking_date >= bounds.month_start
          AND raw_transactions.booking_date < bounds.month_start + interval '1 month'
          AND (
            enriched_transactions.is_income = true
            OR enriched_transactions.is_transfer = true
            OR enriched_transactions.is_savings = true
            OR enriched_transactions.is_excluded_from_budget = true
          )
      ), 0)::text AS excluded_from_forecast
    FROM categories
    CROSS JOIN bounds
    LEFT JOIN enriched_transactions ON enriched_transactions.category_id = categories.id
    LEFT JOIN raw_transactions ON raw_transactions.id = enriched_transactions.raw_transaction_id
    GROUP BY categories.id, categories.name, bounds.year_month
    ORDER BY
      CASE WHEN categories.name IN ('Income', 'Transfers', 'Savings', 'One-off / Large purchase', 'Unknown')
        THEN 1 ELSE 0 END,
      categories.name
  `);
  const yearMonth = result.rows[0]?.year_month ?? currentYearMonth();
  const categories = result.rows.map(toCategoryBudget);
  const included = categories.filter((category) => category.includedInForecast);

  return {
    categories,
    totals: {
      currentMonth: moneySum(included.map((category) => category.currentMonth)),
      excludedFromForecast: moneySum(categories.map((category) => category.excludedFromForecast)),
      includedCount: included.length,
      overCount: included.filter((category) => category.status === "over").length,
      suggestedBudget: moneySum(included.map((category) => category.suggestedBudget)),
      watchCount: included.filter((category) => category.status === "watch").length,
    },
    yearMonth,
  };
}

function toCategoryBudget(row: CategoryBudgetRow): CategoryBudgetResponse["categories"][number] {
  const currentMonth = numberValue(row.current_month);
  const average3m = numberValue(row.prior_3m) / 3;
  const average6m = numberValue(row.prior_6m) / 6;
  const average12m = numberValue(row.prior_12m) / 12;
  const suggestedBudget = roundUpBudget(Math.max(currentMonth, average3m, average6m, average12m));
  const includedInForecast = !forecastExcludedCategories.has(row.name);

  return {
    average12m: formatMoney(average12m),
    average3m: formatMoney(average3m),
    average6m: formatMoney(average6m),
    currentMonth: formatMoney(currentMonth),
    excludedFromForecast: formatMoney(row.excluded_from_forecast),
    id: Number(row.id),
    includedInForecast,
    name: row.name,
    paceLabel: paceLabel(currentMonth, suggestedBudget),
    status: paceStatus(currentMonth, suggestedBudget),
    suggestedBudget: formatMoney(suggestedBudget),
  };
}

function numberValue(value: string | number): number {
  return Number(value) || 0;
}

function formatMoney(value: string | number): string {
  return numberValue(value).toFixed(2);
}

function moneySum(values: string[]): string {
  return formatMoney(values.reduce((sum, value) => sum + numberValue(value), 0));
}

function roundUpBudget(value: number): number {
  if (value <= 0) {
    return 0;
  }
  return Math.ceil(value / 10) * 10;
}

function paceStatus(
  currentMonth: number,
  suggestedBudget: number,
): CategoryBudgetResponse["categories"][number]["status"] {
  if (suggestedBudget <= 0) {
    return "empty";
  }
  if (currentMonth > suggestedBudget) {
    return "over";
  }
  if (currentMonth >= suggestedBudget * 0.8) {
    return "watch";
  }
  return "ok";
}

function paceLabel(currentMonth: number, suggestedBudget: number): string {
  const status = paceStatus(currentMonth, suggestedBudget);
  if (status === "empty") {
    return "no budget yet";
  }
  const delta = currentMonth - suggestedBudget;
  if (delta > 0) {
    return `EUR ${formatMoney(delta)} over`;
  }
  if (delta < 0) {
    return `EUR ${formatMoney(Math.abs(delta))} left`;
  }
  return "on budget";
}

function currentYearMonth(): string {
  return new Date().toISOString().slice(0, 7);
}
