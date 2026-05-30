import type pg from "pg";

import type { SettingsResponse } from "../../shared/operations.ts";

export async function loadSettings(pool: pg.Pool): Promise<SettingsResponse> {
  const result = await pool.query<{ key: string; value_json: unknown }>(
    "SELECT key, value_json FROM app_settings WHERE key IN ('target_monthly_savings', 'safety_buffer', 'baseline_months')",
  );
  const values = new Map(result.rows.map((row) => [row.key, row.value_json]));
  return {
    baselineMonths: Number(readObject(values.get("baseline_months")).value ?? 6),
    safetyBuffer: String(readObject(values.get("safety_buffer")).amount ?? "1000.00"),
    targetMonthlySavings: String(
      readObject(values.get("target_monthly_savings")).amount ?? "1000.00",
    ),
  };
}

export async function saveSettings(pool: pg.Pool, settings: SettingsResponse): Promise<void> {
  await pool.query(
    `
      INSERT INTO app_settings (key, value_json)
      VALUES
        ('target_monthly_savings', $1::jsonb),
        ('safety_buffer', $2::jsonb),
        ('baseline_months', $3::jsonb)
      ON CONFLICT (key) DO UPDATE SET value_json = EXCLUDED.value_json, updated_at = now()
    `,
    [
      JSON.stringify({ amount: settings.targetMonthlySavings, currency: "EUR" }),
      JSON.stringify({ amount: settings.safetyBuffer, currency: "EUR" }),
      JSON.stringify({ value: settings.baselineMonths }),
    ],
  );
}

export async function loadStatus(pool: pg.Pool) {
  const [sync, failedJobs] = await Promise.all([
    pool.query<{ provider: string; status: string }>(
      "SELECT provider, status FROM sync_runs ORDER BY started_at DESC LIMIT 1",
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
  return {
    database: "ok",
    failedJobs: failedJobs.rows.map((row) => ({
      error: redact(row.error),
      name: row.name,
      startedAt: row.started_at,
    })),
    latestSync: sync.rows[0] ?? null,
    secrets: "redacted" as const,
  };
}

function readObject(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function redact(value: string | null): string | null {
  return value?.replace(/(token|secret|password)=\S+/gi, "$1=[redacted]") ?? null;
}
