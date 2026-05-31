import crypto from "node:crypto";
import type pg from "pg";

import { workbookBuffer, workbookSheetNames } from "./exportWorkbook.ts";

const xlsxContentType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
export async function createXlsxExport(pool: pg.Pool, createdBy: string | null = null) {
  const client = await pool.connect();
  const yearMonth = await latestYearMonth(client);
  const periodStart = `${yearMonth}-01`;
  const periodEnd = periodEndDate(periodStart);
  const runId = await createExportRun(client, periodStart, periodEnd, createdBy);

  try {
    const content = await workbookBuffer(client, yearMonth);
    const sha256 = crypto.createHash("sha256").update(content).digest("hex");
    const filename = `budget-averages-${yearMonth}.xlsx`;

    await client.query("BEGIN");
    const file = await client.query<{ id: string }>(
      `
        INSERT INTO export_files (export_run_id, filename, content_type, content, size_bytes, sha256)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id
      `,
      [runId, filename, xlsxContentType, content, content.length, sha256],
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
        runId,
        JSON.stringify({
          periodEnd,
          periodStart,
          sha256,
          sheetNames: workbookSheetNames,
        }),
      ],
    );
    await client.query("COMMIT");
    return { exportRunId: runId, fileId: Number(file.rows[0]?.id) };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    await client.query(
      "UPDATE export_runs SET status = 'failed', finished_at = now(), error_message = $2 WHERE id = $1",
      [runId, sanitizeError(error)],
    );
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
    id: string;
    metadata_json: unknown;
    sha256: string | null;
    size_bytes: number | null;
    status: string;
  }>(`
    SELECT export_runs.id, export_runs.export_type, export_runs.status, export_runs.error_message,
      export_runs.metadata_json,
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
      id: Number(row.id),
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
  periodStart: string,
  periodEnd: string,
  createdBy: string | null,
): Promise<number> {
  const run = await client.query<{ id: string }>(
    `
      INSERT INTO export_runs (
        export_type, period_start, period_end, status, started_at, created_by, metadata_json
      )
      VALUES ('budget_averages', $1, $2, 'running', now(), $3, '{}'::jsonb)
      RETURNING id
    `,
    [periodStart, periodEnd, createdBy],
  );
  return Number(run.rows[0]?.id);
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
