import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { describe, expect, it } from "vitest";

import { runMigrations } from "../../../src/server/db/migrations.ts";
import { withPool } from "../../../src/server/db/pool.ts";
import { runJob } from "../../../src/server/jobs/handlers.ts";
import { loadSampleData } from "../../../src/server/sample/load.ts";

describe("job handlers", () => {
  it("runs the full sync pipeline from the sync_now job", async () => {
    const container = await new PostgreSqlContainer("postgres:16-alpine").start();

    try {
      await withPool(container.getConnectionUri(), async (pool) => {
        await runMigrations(pool);
        await loadSampleData(pool);
        await pool.query("DELETE FROM monthly_forecasts");

        const result = await runJob(pool, "sync_now", {});
        const database = await pool.query<{
          balance_snapshots: string;
          forecasts: string;
          sync_runs: string;
        }>(`
          SELECT
            (SELECT count(*)::text FROM sync_runs WHERE status = 'completed') AS sync_runs,
            (SELECT count(*)::text FROM account_balance_snapshots WHERE source = 'fake')
              AS balance_snapshots,
            (SELECT count(*)::text FROM monthly_forecasts WHERE year_month = '2026-05')
              AS forecasts
        `);

        expect(result).toMatchObject({
          forecastYearMonth: "2026-05",
          provider: "fake",
        });
        expect(database.rows[0]).toMatchObject({
          balance_snapshots: expect.any(String),
          forecasts: "1",
          sync_runs: expect.any(String),
        });
        expect(Number(database.rows[0]?.balance_snapshots ?? 0)).toBeGreaterThan(1);
        expect(Number(database.rows[0]?.sync_runs ?? 0)).toBeGreaterThan(0);
      });
    } finally {
      await container.stop();
    }
  }, 120_000);
});
