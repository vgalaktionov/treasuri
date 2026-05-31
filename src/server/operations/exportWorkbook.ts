import ExcelJS from "exceljs";
import type pg from "pg";

export const workbookSheetNames = [
  "Summary",
  "Category averages",
  "Monthly history",
  "Recurring expenses",
  "Excluded one-offs",
  "Raw transactions",
  "Rules",
  "Forecast assumptions",
] as const;

export async function workbookBuffer(client: pg.PoolClient, yearMonth: string): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "treasuri";
  workbook.created = new Date();

  await writeSummarySheet(client, workbook.addWorksheet(workbookSheetNames[0]), yearMonth);
  await writeCategoryAveragesSheet(client, workbook.addWorksheet(workbookSheetNames[1]), yearMonth);
  await writeMonthlyHistorySheet(client, workbook.addWorksheet(workbookSheetNames[2]));
  await writeRecurringSheet(client, workbook.addWorksheet(workbookSheetNames[3]));
  await writeExcludedOneOffsSheet(client, workbook.addWorksheet(workbookSheetNames[4]));
  await writeRawTransactionsSheet(client, workbook.addWorksheet(workbookSheetNames[5]));
  await writeRulesSheet(client, workbook.addWorksheet(workbookSheetNames[6]));
  await writeAssumptionsSheet(client, workbook.addWorksheet(workbookSheetNames[7]));

  for (const sheet of workbook.worksheets) {
    sheet.views = [{ state: "frozen", ySplit: 1 }];
    sheet.columns.forEach((column) => {
      column.width = Math.min(Math.max(column.values?.join("").length ?? 12, 12), 32);
    });
  }

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

async function writeSummarySheet(
  client: pg.PoolClient,
  sheet: ExcelJS.Worksheet,
  yearMonth: string,
) {
  const forecast = await client.query<{
    confidence: string;
    projected_savings: string;
    safe_to_spend: string;
    safety_buffer: string;
    target_savings: string;
  }>(
    `
      SELECT target_savings::text, safety_buffer::text, safe_to_spend::text,
        projected_savings::text, confidence
      FROM monthly_forecasts
      WHERE year_month = $1
    `,
    [yearMonth],
  );
  const row = forecast.rows[0];
  sheet.addRows([
    ["generated_at", new Date().toISOString()],
    ["period covered", yearMonth],
    ["target savings", row?.target_savings ?? "0.00"],
    ["safety buffer", row?.safety_buffer ?? "0.00"],
    ["safe to spend", row?.safe_to_spend ?? "0.00"],
    ["projected savings", row?.projected_savings ?? "0.00"],
    ["forecast confidence", row?.confidence ?? "low"],
  ]);
}

async function writeCategoryAveragesSheet(
  client: pg.PoolClient,
  sheet: ExcelJS.Worksheet,
  yearMonth: string,
) {
  sheet.addRow([
    "Category",
    "3M average",
    "6M average",
    "12M average",
    "Current month",
    "Suggested budget",
    "Included in forecast",
    "Notes",
  ]);
  const rows = await client.query<{
    current_month: string;
    excluded_from_forecast: string;
    name: string;
    prior_12m: string;
    prior_3m: string;
    prior_6m: string;
  }>(categoryAveragesQuery, [yearMonth]);

  for (const row of rows.rows) {
    const average3m = money(row.prior_3m) / 3;
    const average6m = money(row.prior_6m) / 6;
    const average12m = money(row.prior_12m) / 12;
    const currentMonth = money(row.current_month);
    const includedInForecast = !forecastExcludedCategory(row.name);
    const suggestedBudget = includedInForecast
      ? roundUpBudget(Math.max(currentMonth, average3m, average6m, average12m))
      : 0;
    sheet.addRow([
      row.name,
      formatMoney(average3m),
      formatMoney(average6m),
      formatMoney(average12m),
      formatMoney(currentMonth),
      formatMoney(suggestedBudget),
      includedInForecast,
      `Excluded this month: ${formatMoney(row.excluded_from_forecast)}`,
    ]);
  }
}

const categoryAveragesQuery = `
  WITH bounds AS (
    SELECT to_date($1 || '-01', 'YYYY-MM-DD') AS month_start
  )
  SELECT
    categories.name,
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
  GROUP BY categories.name
  ORDER BY categories.name
`;

async function writeMonthlyHistorySheet(client: pg.PoolClient, sheet: ExcelJS.Worksheet) {
  sheet.addRow([
    "Month",
    "Income",
    "Fixed costs",
    "Variable costs",
    "Savings",
    "Excluded spending",
  ]);
  const rows = await client.query<{
    excluded_spending: string;
    fixed_costs_paid: string;
    income_received: string;
    projected_savings: string;
    variable_spent: string;
    year_month: string;
  }>(`
    SELECT monthly_forecasts.year_month, monthly_forecasts.income_received::text,
      monthly_forecasts.fixed_costs_paid::text, monthly_forecasts.variable_spent::text,
      monthly_forecasts.projected_savings::text,
      COALESCE(sum(abs(raw_transactions.amount)) FILTER (
        WHERE enriched_transactions.is_excluded_from_budget = true
      ), 0)::text AS excluded_spending
    FROM monthly_forecasts
    LEFT JOIN raw_transactions ON to_char(raw_transactions.booking_date, 'YYYY-MM') = monthly_forecasts.year_month
    LEFT JOIN enriched_transactions ON enriched_transactions.raw_transaction_id = raw_transactions.id
    GROUP BY monthly_forecasts.id
    ORDER BY monthly_forecasts.year_month
  `);
  for (const row of rows.rows) {
    sheet.addRow([
      row.year_month,
      row.income_received,
      row.fixed_costs_paid,
      row.variable_spent,
      row.projected_savings,
      row.excluded_spending,
    ]);
  }
}

async function writeRecurringSheet(client: pg.PoolClient, sheet: ExcelJS.Worksheet) {
  sheet.addRow([
    "Name",
    "Category",
    "Cadence",
    "Expected amount",
    "Next expected date",
    "Confidence",
    "Confirmed",
  ]);
  const rows = await client.query<{
    cadence: string;
    category: string;
    confidence: string;
    expected_amount: string | null;
    is_confirmed: boolean;
    name: string;
    next_expected_date: string | null;
  }>(`
    SELECT recurring_series.name, COALESCE(categories.name, 'Unknown') AS category,
      recurring_series.cadence, recurring_series.expected_amount::text,
      recurring_series.next_expected_date::text, recurring_series.confidence::text,
      recurring_series.is_confirmed
    FROM recurring_series
    LEFT JOIN categories ON categories.id = recurring_series.category_id
    ORDER BY recurring_series.name
  `);
  for (const row of rows.rows) {
    sheet.addRow([
      row.name,
      row.category,
      row.cadence,
      row.expected_amount ?? "",
      row.next_expected_date ?? "",
      row.confidence,
      row.is_confirmed,
    ]);
  }
}

async function writeExcludedOneOffsSheet(client: pg.PoolClient, sheet: ExcelJS.Worksheet) {
  sheet.addRow(["Date", "Amount", "Merchant", "Description", "Category", "Reason"]);
  const rows = await client.query<{
    amount: string;
    booking_date: string;
    category: string;
    description: string;
    merchant: string;
    notes: string | null;
  }>(`
    SELECT raw_transactions.booking_date::text, raw_transactions.amount::text,
      COALESCE(merchants.name, raw_transactions.counterparty_name, '') AS merchant,
      raw_transactions.description, COALESCE(categories.name, 'Unknown') AS category,
      enriched_transactions.notes
    FROM enriched_transactions
    JOIN raw_transactions ON raw_transactions.id = enriched_transactions.raw_transaction_id
    LEFT JOIN merchants ON merchants.id = enriched_transactions.merchant_id
    LEFT JOIN categories ON categories.id = enriched_transactions.category_id
    WHERE enriched_transactions.is_excluded_from_budget = true
      OR enriched_transactions.is_one_off = true
    ORDER BY raw_transactions.booking_date
  `);
  for (const row of rows.rows) {
    sheet.addRow([
      row.booking_date,
      row.amount,
      row.merchant,
      row.description,
      row.category,
      row.notes ?? "",
    ]);
  }
}

async function writeRawTransactionsSheet(client: pg.PoolClient, sheet: ExcelJS.Worksheet) {
  sheet.addRow([
    "Date",
    "Amount",
    "Counterparty",
    "Description",
    "Category",
    "Classification",
    "Needs review",
  ]);
  const rows = await client.query<{
    amount: string;
    booking_date: string;
    category: string;
    classification_method: string;
    counterparty_name: string | null;
    description: string;
    needs_review: boolean | null;
  }>(`
    SELECT raw_transactions.booking_date::text, raw_transactions.amount::text,
      raw_transactions.counterparty_name, raw_transactions.description,
      COALESCE(categories.name, 'Unknown') AS category,
      COALESCE(enriched_transactions.classification_method, 'none') AS classification_method,
      enriched_transactions.needs_review
    FROM raw_transactions
    LEFT JOIN enriched_transactions ON enriched_transactions.raw_transaction_id = raw_transactions.id
    LEFT JOIN categories ON categories.id = enriched_transactions.category_id
    ORDER BY raw_transactions.booking_date
  `);
  for (const row of rows.rows) {
    sheet.addRow([
      row.booking_date,
      row.amount,
      row.counterparty_name ?? "",
      row.description,
      row.category,
      row.classification_method,
      row.needs_review ?? false,
    ]);
  }
}

async function writeRulesSheet(client: pg.PoolClient, sheet: ExcelJS.Worksheet) {
  sheet.addRow([
    "Name",
    "Priority",
    "Active",
    "Field",
    "Operator",
    "Pattern",
    "Category",
    "Merchant",
  ]);
  const rows = await client.query<{
    category: string | null;
    field: string;
    is_active: boolean;
    merchant: string | null;
    name: string;
    operator: string;
    pattern: string;
    priority: number;
  }>(`
    SELECT categorization_rules.name, categorization_rules.priority,
      categorization_rules.is_active, categorization_rules.field, categorization_rules.operator,
      categorization_rules.pattern, categories.name AS category, merchants.name AS merchant
    FROM categorization_rules
    LEFT JOIN categories ON categories.id = categorization_rules.category_id
    LEFT JOIN merchants ON merchants.id = categorization_rules.merchant_id
    ORDER BY categorization_rules.priority, categorization_rules.id
  `);
  for (const row of rows.rows) {
    sheet.addRow([
      row.name,
      row.priority,
      row.is_active,
      row.field,
      row.operator,
      row.pattern,
      row.category ?? "",
      row.merchant ?? "",
    ]);
  }
}

async function writeAssumptionsSheet(client: pg.PoolClient, sheet: ExcelJS.Worksheet) {
  sheet.addRow(["Key", "Value"]);
  const rows = await client.query<{ key: string; value_json: unknown }>(
    "SELECT key, value_json FROM app_settings ORDER BY key",
  );
  if (rows.rows.length === 0) {
    sheet.addRow(["source", "deterministic sample or current database state"]);
    return;
  }
  for (const row of rows.rows) {
    sheet.addRow([row.key, JSON.stringify(row.value_json)]);
  }
}

function forecastExcludedCategory(category: string): boolean {
  return ["Income", "Transfers", "Savings", "One-off / Large purchase", "Unknown"].includes(
    category,
  );
}

function money(value: string | number | null): number {
  return Number(value ?? 0) || 0;
}

function formatMoney(value: string | number): string {
  return money(value).toFixed(2);
}

function roundUpBudget(value: number): number {
  return value <= 0 ? 0 : Math.ceil(value / 10) * 10;
}
