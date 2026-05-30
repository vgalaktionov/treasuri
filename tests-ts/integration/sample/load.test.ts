import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { describe, expect, it } from "vitest";

import { runMigrations } from "../../../src/server/db/migrations.ts";
import { withPool } from "../../../src/server/db/pool.ts";
import { sampleTransactions } from "../../../src/server/sample/data.ts";
import { loadSampleData } from "../../../src/server/sample/load.ts";

describe("loadSampleData", () => {
  it("loads deterministic sample data idempotently", async () => {
    const container = await new PostgreSqlContainer("postgres:16-alpine").start();

    try {
      await withPool(container.getConnectionUri(), async (pool) => {
        await runMigrations(pool);
        await loadSampleData(pool);
        await loadSampleData(pool);

        const counts = await pool.query<{
          balance_snapshots: string;
          enriched_transactions: string;
          raw_transactions: string;
          review_transactions: string;
          sync_runs: string;
        }>(`
          SELECT
            (SELECT count(*) FROM raw_transactions) AS raw_transactions,
            (SELECT count(*) FROM enriched_transactions) AS enriched_transactions,
            (SELECT count(*) FROM enriched_transactions WHERE needs_review = true) AS review_transactions,
            (SELECT count(*) FROM account_balance_snapshots) AS balance_snapshots,
            (SELECT count(*) FROM sync_runs WHERE metadata_json @> '{"source":"sample"}') AS sync_runs
        `);
        const forecast = await pool.query<{ safe_to_spend: string }>(
          "SELECT safe_to_spend FROM monthly_forecasts WHERE year_month = '2026-05'",
        );

        expect(counts.rows[0]).toEqual({
          balance_snapshots: "1",
          enriched_transactions: String(sampleTransactions.length),
          raw_transactions: String(sampleTransactions.length),
          review_transactions: "1",
          sync_runs: "1",
        });
        expect(forecast.rows[0]?.safe_to_spend).toBe("558.00");
      });
    } finally {
      await container.stop();
    }
  }, 60_000);
});
