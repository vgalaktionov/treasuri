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
      await request(app)
        .put("/api/settings")
        .send({ baselineMonths: 9, safetyBuffer: "1500.00", targetMonthlySavings: "1200.00" })
        .expect(200);

      const saved = await request(app).get("/api/settings").expect(200);

      expect(saved.body).toEqual({
        baselineMonths: 9,
        safetyBuffer: "1500.00",
        targetMonthlySavings: "1200.00",
      });
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
      expect(listed.body.exports[0].status).toBe("completed");
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

      expect(status.body.secrets).toBe("redacted");
      expect(status.body.failedJobs[0].name).toBe("sync_abn_transactions");
      expect(status.body.failedJobs[0].error).toContain("token=[redacted]");
      expect(status.body.failedJobs[0].error).not.toContain("secret-value");
    } finally {
      await boss.stop();
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
