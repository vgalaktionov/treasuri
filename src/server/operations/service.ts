import type pg from "pg";

import type { SettingsResponse, SettingsUpdate, StatusResponse } from "../../shared/operations.ts";
import { describeRuntime } from "../../shared/version.ts";
import type { AppConfig } from "../config/env.ts";

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

export async function loadStatus(pool: pg.Pool, config: AppConfig): Promise<StatusResponse> {
  const [
    database,
    sync,
    transactions,
    classificationMethods,
    forecast,
    exportRun,
    jobCounts,
    latestJob,
    failedJobs,
  ] = await Promise.all([
    pool.query<{ version: string }>(
      "SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1",
    ),
    pool.query<{
      error_message: string | null;
      finished_at: string | null;
      metadata_json: Record<string, unknown>;
      new_transaction_count: number;
      provider: string;
      status: string;
      updated_transaction_count: number;
    }>(
      `
        SELECT provider, status, finished_at::text, new_transaction_count,
          updated_transaction_count, error_message, metadata_json
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
    pool.query<{ count: string; method: string }>(
      `
        SELECT COALESCE(NULLIF(classification_method, ''), 'none') AS method, count(*)::text
        FROM enriched_transactions
        GROUP BY 1
        ORDER BY 1
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
      .query<{ count: string; state: string }>(`
        SELECT state::text, count(*)::text
        FROM pgboss.job
        GROUP BY state
        ORDER BY state::text
      `)
      .catch(() => ({ rows: [] })),
    pool
      .query<{ at: string | null; error: string | null; name: string; state: string }>(`
        SELECT name, state::text,
          COALESCE(completed_on, started_on, created_on)::text AS at,
          output::text AS error
        FROM pgboss.job
        ORDER BY COALESCE(completed_on, started_on, created_on) DESC NULLS LAST, id DESC
        LIMIT 1
      `)
      .catch(() => ({ rows: [] })),
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
        rows: [
          { label: "Connection", value: "configured" },
          { label: "Migration version", value: database.rows[0]?.version ?? "none" },
        ],
        title: "Database",
      },
      { rows: syncRows(sync.rows[0]), title: "Sync" },
      {
        rows: transactionRows(transactions.rows[0], classificationMethods.rows),
        title: "Transactions",
      },
      { rows: forecastRows(forecast.rows[0]), title: "Forecast" },
      { rows: workerRows(failedJobRows, jobCounts.rows, latestJob.rows[0]), title: "Worker" },
      { rows: exportRows(exportRun.rows[0]), title: "Exports" },
      {
        rows: runtimeRows(config),
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
        metadata_json: Record<string, unknown>;
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
    ...syncMetadataRows(row.metadata_json),
  ];
}

function syncMetadataRows(metadata: Record<string, unknown>) {
  const rows: { detail?: string; label: string; value: string }[] = [];
  const lastMutationKey = stringMetadata(metadata.last_mutation_key);
  if (lastMutationKey) {
    rows.push({
      detail: "Stored from the latest completed ABN mutation page.",
      label: "ABN cursor",
      value: lastMutationKey,
    });
  }
  if (metadata.clear_cache_indicator === true || metadata.cursor_reset === true) {
    rows.push({
      detail: "ABN requested local cursor reset on the last sync.",
      label: "ABN cursor reset",
      value: metadata.cursor_reset === true ? "yes" : "pending",
    });
  }
  return rows;
}

function stringMetadata(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function transactionRows(
  row: { classified: string; needs_review: string; total: string } | undefined,
  methodRows: { count: string; method: string }[],
) {
  return [
    { label: "Known transactions", value: `${row?.total ?? "0"} total` },
    { label: "Classified transactions", value: row?.classified ?? "0" },
    { label: "Needs review", value: row?.needs_review ?? "0" },
    { label: "Classification methods", value: classificationMethodCounts(methodRows) },
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

function workerRows(
  failedJobs: { error: string | null; name: string; startedAt: string }[],
  countRows: { count: string; state: string }[],
  latest: { at: string | null; error: string | null; name: string; state: string } | undefined,
) {
  return [
    {
      detail: jobStateCounts(countRows),
      label: "Queued jobs",
      value: jobStateValue(countRows, "created"),
    },
    { label: "Failed jobs", value: String(failedJobs.length) },
    ...(failedJobs[0]
      ? [{ detail: failedJobs[0].error, label: "Latest failed job", value: failedJobs[0].name }]
      : []),
    latestJobRow(latest),
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

function runtimeRows(config: AppConfig) {
  return [
    { label: "Runtime", value: describeRuntime() },
    { label: "Environment", value: config.appEnv },
    { label: "Secrets", value: "redacted" },
    { label: "OIDC", value: config.oidc.enabled ? "enabled" : "disabled" },
    { label: "OIDC issuer", value: configured(config.oidc.issuerUrl) },
    { label: "OIDC client secret", value: configured(config.oidc.clientSecret) },
    { label: "Allowed emails", value: `${config.allowedEmails.size} configured` },
    { label: "Bank provider", value: process.env.BANK_PROVIDER ?? "fake" },
    { label: "ABN account", value: configured(process.env.ABN_ACCOUNT_IBAN) },
    { label: "ABN card", value: configured(process.env.ABN_CARD_NUMBER) },
    { label: "ABN token", value: configured(process.env.ABN_SOFT_TOKEN) },
    { label: "ABN sync pages", value: process.env.ABN_SYNC_PAGES ?? "1" },
    { label: "LLM endpoint", value: configured(process.env.LLM_BASE_URL) },
    { label: "LLM model", value: process.env.LLM_MODEL ?? "missing" },
  ];
}

function classificationMethodCounts(rows: { count: string; method: string }[]): string {
  if (rows.length === 0) {
    return "none";
  }
  return rows.map((row) => `${row.method} ${row.count}`).join(", ");
}

function jobStateCounts(rows: { count: string; state: string }[]): string | null {
  if (rows.length === 0) {
    return null;
  }
  return rows.map((row) => `${row.state} ${row.count}`).join(", ");
}

function jobStateValue(rows: { count: string; state: string }[], state: string): string {
  return rows.find((row) => row.state === state)?.count ?? "0";
}

function latestJobRow(
  row: { at: string | null; error: string | null; name: string; state: string } | undefined,
) {
  if (!row) {
    return { label: "Latest worker result", value: "none" };
  }
  return {
    detail: [row.name, row.at, redact(row.error)].filter(Boolean).join(", "),
    label: "Latest worker result",
    value: row.state,
  };
}

function configured(value: string | undefined): string {
  return value ? "configured" : "missing";
}
