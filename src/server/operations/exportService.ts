import crypto from "node:crypto";
import ExcelJS from "exceljs";
import type pg from "pg";

export async function createXlsxExport(pool: pg.Pool, createdBy: string | null = null) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const run = await client.query<{ id: string }>(
      "INSERT INTO export_runs (export_type, period_start, period_end, status, started_at, created_by) VALUES ('budget', current_date, current_date, 'running', now(), $1) RETURNING id",
      [createdBy],
    );
    const runId = Number(run.rows[0]?.id);
    const content = await workbookBuffer(client);
    const sha256 = crypto.createHash("sha256").update(content).digest("hex");
    const file = await client.query<{ id: string }>(
      `
        INSERT INTO export_files (export_run_id, filename, content_type, content, size_bytes, sha256)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id
      `,
      [
        runId,
        "treasuri-export.xlsx",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        content,
        content.length,
        sha256,
      ],
    );
    await client.query(
      "UPDATE export_runs SET status = 'completed', finished_at = now() WHERE id = $1",
      [runId],
    );
    await client.query("COMMIT");
    return { exportRunId: runId, fileId: Number(file.rows[0]?.id) };
  } catch (error) {
    await client.query("ROLLBACK");
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
    size_bytes: number | null;
    status: string;
  }>(`
    SELECT export_runs.id, export_runs.export_type, export_runs.status, export_runs.error_message,
      COALESCE(export_runs.finished_at, export_runs.started_at)::text AS created_at,
      max(export_files.id)::text AS file_id,
      max(export_files.filename) AS filename,
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

async function workbookBuffer(client: pg.PoolClient): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Transactions");
  sheet.addRow(["Date", "Amount", "Merchant", "Description", "Category"]);
  const rows = await client.query<{
    amount: string;
    booking_date: string;
    category: string | null;
    description: string;
    merchant: string | null;
  }>(`
    SELECT raw_transactions.booking_date::text, raw_transactions.amount::text,
      COALESCE(merchants.name, raw_transactions.counterparty_name) AS merchant,
      raw_transactions.description, categories.name AS category
    FROM enriched_transactions
    JOIN raw_transactions ON raw_transactions.id = enriched_transactions.raw_transaction_id
    LEFT JOIN merchants ON merchants.id = enriched_transactions.merchant_id
    LEFT JOIN categories ON categories.id = enriched_transactions.category_id
    ORDER BY raw_transactions.booking_date
  `);
  for (const row of rows.rows) {
    sheet.addRow([
      row.booking_date,
      row.amount,
      row.merchant ?? "",
      row.description,
      row.category ?? "",
    ]);
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
