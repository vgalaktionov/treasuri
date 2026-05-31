import type pg from "pg";

import type { SettingsResponse, SettingsUpdate, StatusResponse } from "../../shared/operations.ts";

export async function loadSettings(pool: pg.Pool): Promise<SettingsResponse> {
  const result = await pool.query<{ key: string; value_json: unknown }>(
    `
      SELECT key, value_json
      FROM app_settings
      WHERE key IN (
        'target_monthly_savings', 'safety_buffer', 'baseline_months', 'salary_day',
        'sync_lookback_days', 'fixed_costs_upcoming', 'variable_baseline_3m',
        'variable_baseline_6m', 'llm_enabled', 'llm_confidence_threshold'
      )
    `,
  );
  const values = new Map(result.rows.map((row) => [row.key, row.value_json]));
  const overview = await loadSettingsOverview(
    pool,
    readNumber(values.get("sync_lookback_days"), 90),
  );
  return {
    baselineMonths: Number(readObject(values.get("baseline_months")).value ?? 6),
    fixedCostsUpcoming: readAmount(values.get("fixed_costs_upcoming"), "0.00"),
    llmConfidenceThreshold: readAmount(values.get("llm_confidence_threshold"), "0.70"),
    llmEnabled: readBoolean(values.get("llm_enabled"), false),
    overview,
    safetyBuffer: String(readObject(values.get("safety_buffer")).amount ?? "1000.00"),
    salaryDay: readNumber(values.get("salary_day"), 24),
    syncLookbackDays: readNumber(values.get("sync_lookback_days"), 90),
    targetMonthlySavings: String(
      readObject(values.get("target_monthly_savings")).amount ?? "1000.00",
    ),
    variableBaseline3m: readAmount(values.get("variable_baseline_3m"), "0.00"),
    variableBaseline6m: readAmount(values.get("variable_baseline_6m"), "0.00"),
  };
}

export async function saveSettings(pool: pg.Pool, settings: SettingsUpdate): Promise<void> {
  await pool.query(
    `
      INSERT INTO app_settings (key, value_json)
      VALUES
        ('target_monthly_savings', $1::jsonb),
        ('safety_buffer', $2::jsonb),
        ('baseline_months', $3::jsonb),
        ('salary_day', $4::jsonb),
        ('sync_lookback_days', $5::jsonb),
        ('fixed_costs_upcoming', $6::jsonb),
        ('variable_baseline_3m', $7::jsonb),
        ('variable_baseline_6m', $8::jsonb),
        ('llm_enabled', $9::jsonb),
        ('llm_confidence_threshold', $10::jsonb)
      ON CONFLICT (key) DO UPDATE SET value_json = EXCLUDED.value_json, updated_at = now()
    `,
    [
      JSON.stringify({ amount: settings.targetMonthlySavings, currency: "EUR" }),
      JSON.stringify({ amount: settings.safetyBuffer, currency: "EUR" }),
      JSON.stringify({ value: settings.baselineMonths }),
      JSON.stringify({ value: settings.salaryDay }),
      JSON.stringify({ value: settings.syncLookbackDays }),
      JSON.stringify({ amount: settings.fixedCostsUpcoming, currency: "EUR" }),
      JSON.stringify({ amount: settings.variableBaseline3m, currency: "EUR" }),
      JSON.stringify({ amount: settings.variableBaseline6m, currency: "EUR" }),
      JSON.stringify({ value: settings.llmEnabled }),
      JSON.stringify({ amount: settings.llmConfidenceThreshold }),
    ],
  );
}

export async function loadStatus(pool: pg.Pool): Promise<StatusResponse> {
  const [database, sync, transactions, forecast, exportRun, failedJobs] = await Promise.all([
    pool.query<{ version: string }>(
      "SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1",
    ),
    pool.query<{
      error_message: string | null;
      finished_at: string | null;
      new_transaction_count: number;
      provider: string;
      status: string;
      updated_transaction_count: number;
    }>(
      `
        SELECT provider, status, finished_at::text, new_transaction_count,
          updated_transaction_count, error_message
        FROM sync_runs
        ORDER BY started_at DESC, id DESC
        LIMIT 1
      `,
    ),
    pool.query<{ classified: string; needs_review: string; total: string }>(
      `
        SELECT count(*)::text AS total,
          count(*) FILTER (WHERE needs_review = false)::text AS classified,
          count(*) FILTER (WHERE needs_review = true)::text AS needs_review
        FROM enriched_transactions
      `,
    ),
    pool.query<{
      confidence: string;
      safe_to_spend: string;
      updated_at: string;
      year_month: string;
    }>(
      `
        SELECT year_month, safe_to_spend::text, confidence, updated_at::text
        FROM monthly_forecasts
        ORDER BY updated_at DESC, id DESC
        LIMIT 1
      `,
    ),
    pool.query<{
      error_message: string | null;
      filename: string | null;
      finished_at: string | null;
      status: string;
    }>(
      `
        SELECT export_runs.status, export_files.filename, export_runs.finished_at::text,
          export_runs.error_message
        FROM export_runs
        LEFT JOIN export_files ON export_files.export_run_id = export_runs.id
        ORDER BY export_runs.id DESC
        LIMIT 1
      `,
    ),
    pool
      .query<{ error: string | null; name: string; started_at: string }>(`
        SELECT name, started_on::text AS started_at, output::text AS error
        FROM pgboss.job
        WHERE state = 'failed'
        ORDER BY started_on DESC
        LIMIT 10
      `)
      .catch(() => ({ rows: [] })),
  ]);
  const failedJobRows = failedJobs.rows.map((row) => ({
    error: redact(row.error),
    name: row.name,
    startedAt: row.started_at,
  }));
  return {
    failedJobs: failedJobRows,
    sections: [
      {
        rows: [{ label: "Migration version", value: database.rows[0]?.version ?? "none" }],
        title: "Database",
      },
      { rows: syncRows(sync.rows[0]), title: "Sync" },
      { rows: transactionRows(transactions.rows[0]), title: "Transactions" },
      { rows: forecastRows(forecast.rows[0]), title: "Forecast" },
      { rows: workerRows(failedJobRows), title: "Worker" },
      { rows: exportRows(exportRun.rows[0]), title: "Exports" },
      {
        rows: [
          { label: "Secrets", value: "redacted" },
          { label: "OIDC", value: process.env.OIDC_ENABLED === "true" ? "enabled" : "disabled" },
          { label: "Bank provider", value: process.env.BANK_PROVIDER ?? "fake" },
        ],
        title: "Runtime",
      },
    ],
    secrets: "redacted" as const,
  };
}

async function loadSettingsOverview(pool: pg.Pool, lookbackDays: number) {
  const [accounts, categories, sync] = await Promise.all([
    pool.query<{
      currency: string;
      iban: string;
      is_active: boolean;
      name: string;
      provider: string;
    }>(
      "SELECT name, provider, iban, currency, is_active FROM accounts ORDER BY is_active DESC, provider, name",
    ),
    pool.query<{ name: string }>("SELECT name FROM categories ORDER BY name"),
    pool.query<{ finished_at: string | null; provider: string; status: string }>(
      "SELECT provider, status, finished_at::text FROM sync_runs ORDER BY started_at DESC, id DESC LIMIT 1",
    ),
  ]);
  return {
    accounts: accounts.rows.map((row) => ({
      currency: row.currency,
      iban: row.iban,
      name: row.name,
      provider: row.provider,
      status: row.is_active ? "Active" : "Inactive",
    })),
    sync: {
      lastSync: sync.rows[0]
        ? `${sync.rows[0].provider} ${sync.rows[0].status}${sync.rows[0].finished_at ? ` at ${sync.rows[0].finished_at}` : ""}`
        : "No sync runs yet",
      lookbackDays,
      schedule: "Manual sync",
    },
    taxonomy: {
      categoryCount: categories.rows.length,
      sampleCategories: categories.rows.slice(0, 6).map((row) => row.name),
    },
  };
}

function readObject(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function readAmount(value: unknown, fallback: string): string {
  const object = readObject(value);
  return String(object.amount ?? fallback);
}

function readNumber(value: unknown, fallback: number): number {
  const object = readObject(value);
  return Number(object.value ?? fallback);
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  const object = readObject(value);
  return typeof object.value === "boolean" ? object.value : fallback;
}

function redact(value: string | null): string | null {
  return value?.replace(/(token|secret|password)=\S+/gi, "$1=[redacted]") ?? null;
}

function syncRows(
  row:
    | {
        error_message: string | null;
        finished_at: string | null;
        new_transaction_count: number;
        provider: string;
        status: string;
        updated_transaction_count: number;
      }
    | undefined,
) {
  if (!row) {
    return [{ label: "Last sync", value: "none" }];
  }
  return [
    {
      detail: `${row.new_transaction_count} new, ${row.updated_transaction_count} updated${row.finished_at ? `, finished ${row.finished_at}` : ""}`,
      label: "Last sync",
      value: `${row.provider} ${row.status}`,
    },
    ...(row.error_message ? [{ label: "Last error", value: redact(row.error_message) ?? "" }] : []),
  ];
}

function transactionRows(
  row: { classified: string; needs_review: string; total: string } | undefined,
) {
  return [
    { label: "Known transactions", value: `${row?.total ?? "0"} total` },
    { label: "Classified transactions", value: row?.classified ?? "0" },
    { label: "Needs review", value: row?.needs_review ?? "0" },
  ];
}

function forecastRows(
  row:
    | { confidence: string; safe_to_spend: string; updated_at: string; year_month: string }
    | undefined,
) {
  if (!row) {
    return [{ label: "Last forecast update", value: "none" }];
  }
  return [
    {
      detail: `safe to spend ${row.safe_to_spend}, confidence ${row.confidence}, updated ${row.updated_at}`,
      label: "Last forecast update",
      value: row.year_month,
    },
  ];
}

function workerRows(failedJobs: { error: string | null; name: string; startedAt: string }[]) {
  return [
    { label: "Failed jobs", value: String(failedJobs.length) },
    ...(failedJobs[0]
      ? [{ detail: failedJobs[0].error, label: "Latest failed job", value: failedJobs[0].name }]
      : []),
  ];
}

function exportRows(
  row:
    | {
        error_message: string | null;
        filename: string | null;
        finished_at: string | null;
        status: string;
      }
    | undefined,
) {
  if (!row) {
    return [{ label: "Latest export", value: "none" }];
  }
  return [
    {
      detail: [
        row.filename,
        row.finished_at ? `finished ${row.finished_at}` : null,
        row.error_message,
      ]
        .filter(Boolean)
        .join(", "),
      label: "Latest export",
      value: row.status,
    },
  ];
}
