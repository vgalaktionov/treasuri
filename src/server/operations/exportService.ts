import crypto from "node:crypto";
import type pg from "pg";

import { workbookBuffer, workbookSheetNames } from "./exportWorkbook.ts";

const xlsxContentType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export async function createPendingXlsxExport(
  pool: pg.Pool,
  createdBy: string | null = null,
): Promise<number> {
  const client = await pool.connect();
  try {
    const yearMonth = await latestYearMonth(client);
    const periodStart = `${yearMonth}-01`;
    const periodEnd = periodEndDate(periodStart);
    return createExportRun(client, {
      createdBy,
      periodEnd,
      periodStart,
      status: "pending",
    });
  } finally {
    client.release();
  }
}

export async function createXlsxExport(
  pool: pg.Pool,
  createdBy: string | null = null,
  runId?: number,
) {
  const client = await pool.connect();
  let run: Awaited<ReturnType<typeof createRunningExportRun>> | null = null;
  try {
    run = runId
      ? await startPendingExportRun(client, runId)
      : await createRunningExportRun(client, createdBy);
    const content = await workbookBuffer(client, run.yearMonth);
    const sha256 = crypto.createHash("sha256").update(content).digest("hex");
    const filename = `budget-averages-${run.yearMonth}.xlsx`;

    await client.query("BEGIN");
    const file = await client.query<{ id: string }>(
      `
        INSERT INTO export_files (export_run_id, filename, content_type, content, size_bytes, sha256)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id
      `,
      [run.id, filename, xlsxContentType, content, content.length, sha256],
    );
    await client.query(
      `
        UPDATE export_runs
        SET status = 'completed',
            finished_at = now(),
            metadata_json = $2::jsonb
        WHERE id = $1
      `,
      [
        run.id,
        JSON.stringify({
          periodEnd: run.periodEnd,
          periodStart: run.periodStart,
          sha256,
          sheetNames: workbookSheetNames,
        }),
      ],
    );
    await client.query("COMMIT");
    return { exportRunId: run.id, fileId: Number(file.rows[0]?.id) };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (run) {
      await client.query(
        "UPDATE export_runs SET status = 'failed', finished_at = now(), error_message = $2 WHERE id = $1",
        [run.id, sanitizeError(error)],
      );
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function listExports(pool: pg.Pool) {
  const result = await pool.query<{
    created_at: string;
    error_message: string | null;
    export_type: string;
    file_id: string | null;
    filename: string | null;
    finished_at: string | null;
    id: string;
    metadata_json: unknown;
    period_end: string | null;
    period_start: string | null;
    sha256: string | null;
    size_bytes: number | null;
    status: string;
  }>(`
    SELECT export_runs.id, export_runs.export_type, export_runs.status, export_runs.error_message,
      export_runs.metadata_json, export_runs.period_start::text, export_runs.period_end::text,
      export_runs.finished_at::text,
      COALESCE(export_runs.finished_at, export_runs.started_at)::text AS created_at,
      max(export_files.id)::text AS file_id,
      max(export_files.filename) AS filename,
      max(export_files.sha256) AS sha256,
      max(export_files.size_bytes)::int AS size_bytes
    FROM export_runs
    LEFT JOIN export_files ON export_files.export_run_id = export_runs.id
    GROUP BY export_runs.id, export_runs.export_type, export_runs.status, export_runs.error_message,
      export_runs.started_at, export_runs.finished_at
    ORDER BY COALESCE(export_runs.finished_at, export_runs.started_at) DESC
    LIMIT 20
  `);
  return {
    exports: result.rows.map((row) => ({
      createdAt: row.created_at,
      errorMessage: row.error_message,
      exportType: row.export_type,
      fileId: row.file_id ? Number(row.file_id) : null,
      filename: row.filename,
      finishedAt: row.finished_at,
      id: Number(row.id),
      periodEnd: row.period_end,
      periodStart: row.period_start,
      sha256: row.sha256,
      sheetNames: sheetNamesFromMetadata(row.metadata_json),
      sizeBytes: row.size_bytes,
      status: row.status,
    })),
  };
}

export async function getExportFile(pool: pg.Pool, fileId: number) {
  const result = await pool.query<{
    content: Buffer;
    content_type: string;
    filename: string;
  }>("SELECT filename, content_type, content FROM export_files WHERE id = $1", [fileId]);
  return result.rows[0] ?? null;
}

async function createExportRun(
  client: pg.PoolClient,
  input: {
    createdBy: string | null;
    periodEnd: string;
    periodStart: string;
    status: "pending" | "running";
  },
): Promise<number> {
  const run = await client.query<{ id: string }>(
    `
      INSERT INTO export_runs (
        export_type, period_start, period_end, status, started_at, created_by, metadata_json
      )
      VALUES ('budget_averages', $1, $2, $3, now(), $4, '{}'::jsonb)
      RETURNING id
    `,
    [input.periodStart, input.periodEnd, input.status, input.createdBy],
  );
  return Number(run.rows[0]?.id);
}

async function createRunningExportRun(client: pg.PoolClient, createdBy: string | null) {
  const yearMonth = await latestYearMonth(client);
  const periodStart = `${yearMonth}-01`;
  const periodEnd = periodEndDate(periodStart);
  const id = await createExportRun(client, {
    createdBy,
    periodEnd,
    periodStart,
    status: "running",
  });
  return { id, periodEnd, periodStart, yearMonth };
}

async function startPendingExportRun(client: pg.PoolClient, runId: number) {
  const result = await client.query<{
    id: string;
    period_end: string;
    period_start: string;
    year_month: string;
  }>(
    `
      UPDATE export_runs
      SET status = 'running',
          started_at = COALESCE(started_at, now()),
          error_message = NULL,
          metadata_json = COALESCE(metadata_json, '{}'::jsonb)
      WHERE id = $1
        AND status IN ('pending', 'running', 'failed')
      RETURNING
        id::text,
        period_start::text,
        period_end::text,
        to_char(period_start, 'YYYY-MM') AS year_month
    `,
    [runId],
  );
  const row = result.rows[0];
  if (!row) {
    throw new Error(`Export run ${runId} was not found or is already completed`);
  }
  return {
    id: Number(row.id),
    periodEnd: row.period_end,
    periodStart: row.period_start,
    yearMonth: row.year_month,
  };
}

async function latestYearMonth(client: pg.PoolClient): Promise<string> {
  const result = await client.query<{ year_month: string }>(
    "SELECT year_month FROM monthly_forecasts ORDER BY year_month DESC LIMIT 1",
  );
  return result.rows[0]?.year_month ?? new Date().toISOString().slice(0, 7);
}

function periodEndDate(periodStart: string): string {
  const start = new Date(`${periodStart}T00:00:00Z`);
  return new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0))
    .toISOString()
    .slice(0, 10);
}

function sanitizeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/(token|secret|password|authorization|credential)=\S+/gi, "$1=[redacted]");
}

function sheetNamesFromMetadata(value: unknown): string[] {
  if (!value || typeof value !== "object" || !("sheetNames" in value)) {
    return [];
  }
  const sheetNames = (value as { sheetNames?: unknown }).sheetNames;
  return Array.isArray(sheetNames)
    ? sheetNames.filter((sheetName): sheetName is string => typeof sheetName === "string")
    : [];
}
