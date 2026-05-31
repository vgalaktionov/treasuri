import { PostgreSqlContainer } from "@testcontainers/postgresql";
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
      const initial = await request(app).get("/api/settings").expect(200);

      expect(JSON.stringify(initial.body)).not.toContain("currentBalance");
      expect(JSON.stringify(initial.body)).not.toContain("currentLiquidBalance");
      await request(app)
        .put("/api/settings")
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

      const saved = await request(app).get("/api/settings").expect(200);

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
      const created = await request(app).post("/api/exports").expect(200);
      const listed = await request(app).get("/api/exports").expect(200);
      const downloaded = await request(app)
        .get(`/api/exports/${created.body.fileId}/download`)
        .expect(200);
      const storedBytes = await withPool(databaseUrl, async (pool) => {
        const result = await pool.query<{ bytes: number }>(
          "SELECT octet_length(content) AS bytes FROM export_files WHERE id = $1",
          [created.body.fileId],
        );
        return result.rows[0]?.bytes ?? 0;
      });

      expect(created.body.fileId).toBeGreaterThan(0);
      expect(listed.body.exports[0].exportType).toBe("budget");
      expect(listed.body.exports[0].filename).toBe("treasuri-export.xlsx");
      expect(listed.body.exports[0].status).toBe("completed");
      expect(listed.body.exports[0].sizeBytes).toBeGreaterThan(1000);
      expect(downloaded.headers["content-type"]).toContain("spreadsheetml.sheet");
      expect(storedBytes).toBeGreaterThan(1000);
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
    } finally {
      await boss.stop();
      await restore();
      await container.stop();
    }
  }, 120_000);

  it("runs a manual bank sync and records status-visible sync data", async () => {
    const { app, container, databaseUrl, restore } = await appWithSampleData();
    try {
      const synced = await request(app).post("/api/sync-now").expect(200);
      const status = await request(app).get("/api/status").expect(200);
      const database = await withPool(databaseUrl, async (pool) => {
        const syncRuns = await pool.query<{ count: string }>(
          "SELECT count(*) FROM sync_runs WHERE status = 'completed' AND metadata_json @> '{\"source\":\"bank-sync\"}'::jsonb",
        );
        const balanceSnapshots = await pool.query<{ count: string }>(
          "SELECT count(*) FROM account_balance_snapshots WHERE source = 'fake'",
        );
        return {
          balanceSnapshots: Number(balanceSnapshots.rows[0]?.count ?? 0),
          syncRuns: Number(syncRuns.rows[0]?.count ?? 0),
        };
      });

      expect(synced.body.provider).toBe("fake");
      expect(synced.body.syncRunId).toBeGreaterThan(0);
      expect(synced.body.updatedTransactionCount).toBeGreaterThan(0);
      expect(database.syncRuns).toBeGreaterThan(0);
      expect(database.balanceSnapshots).toBeGreaterThan(1);
      expect(JSON.stringify(status.body.sections)).toContain("fake completed");
    } finally {
      await restore();
      await container.stop();
    }
  }, 120_000);
});

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
