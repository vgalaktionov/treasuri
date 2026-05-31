import { PostgreSqlContainer } from "@testcontainers/postgresql";
import ExcelJS from "exceljs";
import { PgBoss } from "pg-boss";
import request from "supertest";
import { describe, expect, it } from "vitest";

import { runMigrations } from "../../../src/server/db/migrations.ts";
import { withPool } from "../../../src/server/db/pool.ts";
import { createApp } from "../../../src/server/http/app.ts";
import { loadSampleData } from "../../../src/server/sample/load.ts";

describe("operations API", () => {
  it("stores only user-controlled settings", async () => {
    const { app, container, restore } = await appWithSampleData();
    try {
      const { agent, csrf } = await csrfAgent(app);
      const initial = await agent.get("/api/settings").expect(200);

      expect(JSON.stringify(initial.body)).not.toContain("currentBalance");
      expect(JSON.stringify(initial.body)).not.toContain("currentLiquidBalance");
      await agent
        .put("/api/settings")
        .set("x-csrf-token", csrf)
        .send({
          baselineMonths: 9,
          fixedCostsUpcoming: "640.00",
          llmConfidenceThreshold: "0.82",
          llmEnabled: true,
          safetyBuffer: "1500.00",
          salaryDay: 24,
          syncLookbackDays: 120,
          targetMonthlySavings: "1200.00",
          variableBaseline3m: "700.00",
          variableBaseline6m: "650.00",
        })
        .expect(200);

      const saved = await agent.get("/api/settings").expect(200);

      expect(saved.body.baselineMonths).toBe(9);
      expect(saved.body.fixedCostsUpcoming).toBe("640.00");
      expect(saved.body.llmConfidenceThreshold).toBe("0.82");
      expect(saved.body.llmEnabled).toBe(true);
      expect(saved.body.safetyBuffer).toBe("1500.00");
      expect(saved.body.salaryDay).toBe(24);
      expect(saved.body.syncLookbackDays).toBe(120);
      expect(saved.body.targetMonthlySavings).toBe("1200.00");
      expect(saved.body.variableBaseline3m).toBe("700.00");
      expect(saved.body.variableBaseline6m).toBe("650.00");
      expect(saved.body.overview.accounts.length).toBeGreaterThan(0);
      expect(saved.body.overview.sync.lookbackDays).toBe(120);
      expect(saved.body.overview.taxonomy.categoryCount).toBeGreaterThan(0);
    } finally {
      await restore();
      await container.stop();
    }
  }, 120_000);

  it("stores XLSX exports as Postgres bytea and streams downloads", async () => {
    const { app, container, databaseUrl, restore } = await appWithSampleData();
    try {
      const { agent, csrf } = await csrfAgent(app);
      const created = await agent.post("/api/exports").set("x-csrf-token", csrf).expect(200);
      const listed = await agent.get("/api/exports").expect(200);
      const downloaded = await agent
        .get(`/api/exports/${created.body.fileId}/download`)
        .expect(200);
      const stored = await withPool(databaseUrl, async (pool) => {
        const result = await pool.query<{ bytes: number; content: Buffer }>(
          "SELECT octet_length(content) AS bytes, content FROM export_files WHERE id = $1",
          [created.body.fileId],
        );
        return result.rows[0];
      });
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(Uint8Array.from(stored?.content ?? Buffer.alloc(0)).buffer);

      expect(created.body.fileId).toBeGreaterThan(0);
      expect(listed.body.exports[0].exportType).toBe("budget_averages");
      expect(listed.body.exports[0].filename).toBe("budget-averages-2026-05.xlsx");
      expect(listed.body.exports[0].sha256).toHaveLength(64);
      expect(listed.body.exports[0].sheetNames).toEqual([
        "Summary",
        "Category averages",
        "Monthly history",
        "Recurring expenses",
        "Excluded one-offs",
        "Raw transactions",
        "Rules",
        "Forecast assumptions",
      ]);
      expect(listed.body.exports[0].status).toBe("completed");
      expect(listed.body.exports[0].sizeBytes).toBeGreaterThan(1000);
      expect(downloaded.headers["content-type"]).toContain("spreadsheetml.sheet");
      expect(stored?.bytes).toBeGreaterThan(1000);
      expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(
        listed.body.exports[0].sheetNames,
      );
      expect(workbook.getWorksheet("Summary")?.getCell("B2").value).toBe("2026-05");
      expect(workbook.getWorksheet("Raw transactions")?.rowCount).toBeGreaterThan(1);
      expect(workbook.getWorksheet("Excluded one-offs")?.rowCount).toBeGreaterThan(1);
      expect(workbook.getWorksheet("Recurring expenses")?.rowCount).toBeGreaterThan(1);
    } finally {
      await restore();
      await container.stop();
    }
  }, 120_000);

  it("reports failed pg-boss jobs with redacted errors", async () => {
    const { app, container, databaseUrl, restore } = await appWithSampleData();
    const boss = new PgBoss({ connectionString: databaseUrl });
    try {
      await boss.start();
      await boss.createQueue("sync_abn_transactions");
      await withPool(databaseUrl, async (pool) => {
        await pool.query(`
          INSERT INTO pgboss.job (name, state, started_on, output)
          VALUES (
            'sync_abn_transactions',
            'failed',
            now(),
            '{"message":"token=secret-value"}'::jsonb
          )
        `);
      });

      const status = await request(app).get("/api/status").expect(200);
      const sectionTitles = status.body.sections.map((section: { title: string }) => section.title);

      expect(status.body.secrets).toBe("redacted");
      expect(sectionTitles).toEqual([
        "Database",
        "Sync",
        "Transactions",
        "Forecast",
        "Worker",
        "Exports",
        "Runtime",
      ]);
      expect(status.body.failedJobs[0].name).toBe("sync_abn_transactions");
      expect(status.body.failedJobs[0].error).toContain("token=[redacted]");
      expect(status.body.failedJobs[0].error).not.toContain("secret-value");
      expect(JSON.stringify(status.body.sections)).toContain("Secrets");
      expect(JSON.stringify(status.body.sections)).toContain("redacted");
      expect(JSON.stringify(status.body.sections)).toContain("Runtime");
      expect(JSON.stringify(status.body.sections)).toContain("Allowed emails");
      expect(JSON.stringify(status.body.sections)).toContain("Classification methods");
      expect(JSON.stringify(status.body.sections)).toContain("Queued jobs");
      expect(JSON.stringify(status.body.sections)).toContain("Latest worker result");
    } finally {
      await boss.stop();
      await restore();
      await container.stop();
    }
  }, 120_000);

  it("runs a manual bank sync and records status-visible sync data", async () => {
    const { app, container, databaseUrl, restore } = await appWithSampleData();
    try {
      const { agent, csrf } = await csrfAgent(app);
      await withPool(databaseUrl, async (pool) => {
        await pool.query("DELETE FROM monthly_forecasts");
      });
      const synced = await agent.post("/api/sync-now").set("x-csrf-token", csrf).expect(200);
      const status = await agent.get("/api/status").expect(200);
      const database = await withPool(databaseUrl, async (pool) => {
        const syncRuns = await pool.query<{ count: string }>(
          "SELECT count(*) FROM sync_runs WHERE status = 'completed' AND metadata_json @> '{\"source\":\"bank-sync\"}'::jsonb",
        );
        const balanceSnapshots = await pool.query<{ count: string }>(
          "SELECT count(*) FROM account_balance_snapshots WHERE source = 'fake'",
        );
        const forecasts = await pool.query<{ count: string }>(
          "SELECT count(*) FROM monthly_forecasts WHERE year_month = '2026-05'",
        );
        return {
          balanceSnapshots: Number(balanceSnapshots.rows[0]?.count ?? 0),
          forecasts: Number(forecasts.rows[0]?.count ?? 0),
          syncRuns: Number(syncRuns.rows[0]?.count ?? 0),
        };
      });

      expect(synced.body.provider).toBe("fake");
      expect(synced.body.classifiedCount).toBeGreaterThanOrEqual(0);
      expect(synced.body.forecastYearMonth).toBe("2026-05");
      expect(synced.body.recurringDetectedCount).toBeGreaterThanOrEqual(0);
      expect(synced.body.syncRunId).toBeGreaterThan(0);
      expect(synced.body.updatedTransactionCount).toBeGreaterThan(0);
      expect(database.syncRuns).toBeGreaterThan(0);
      expect(database.balanceSnapshots).toBeGreaterThan(1);
      expect(database.forecasts).toBe(1);
      expect(JSON.stringify(status.body.sections)).toContain("fake completed");
    } finally {
      await restore();
      await container.stop();
    }
  }, 120_000);
});

async function csrfAgent(app: ReturnType<typeof createApp>) {
  const agent = request.agent(app);
  const response = await agent.get("/api/me").expect(200);
  return { agent, csrf: response.body.csrfToken as string };
}

async function appWithSampleData() {
  const container = await new PostgreSqlContainer("postgres:16-alpine").start();
  const databaseUrl = container.getConnectionUri();
  const previousDatabaseUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = databaseUrl;
  await withPool(databaseUrl, async (pool) => {
    await runMigrations(pool);
    await loadSampleData(pool);
  });
  return {
    app: createApp(),
    container,
    databaseUrl,
    restore: async () => {
      if (previousDatabaseUrl === undefined) {
        delete process.env.DATABASE_URL;
      } else {
        process.env.DATABASE_URL = previousDatabaseUrl;
      }
    },
  };
}
