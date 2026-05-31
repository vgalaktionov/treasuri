import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { describe, expect, it } from "vitest";

import { runMigrations } from "../../../src/server/db/migrations.ts";
import { withPool } from "../../../src/server/db/pool.ts";
import { runJob } from "../../../src/server/jobs/handlers.ts";
import { createRule } from "../../../src/server/management/rules.ts";
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

  it("backfills a rule through the worker path and refreshes the forecast", async () => {
    const container = await new PostgreSqlContainer("postgres:16-alpine").start();

    try {
      await withPool(container.getConnectionUri(), async (pool) => {
        await runMigrations(pool);
        await loadSampleData(pool);
        await pool.query("UPDATE monthly_forecasts SET updated_at = '2026-05-01T00:00:00Z'");

        const category = await pool.query<{ id: string }>(
          "SELECT id::text FROM categories WHERE name = 'Groceries'",
        );
        const categoryId = Number(category.rows[0]?.id);
        const ruleId = await createRule(pool, {
          categoryId,
          field: "description",
          flags: {
            setIsExcludedFromBudget: false,
            setIsFixedCost: true,
            setIsIncome: false,
            setIsSavings: false,
            setIsTransfer: false,
          },
          isActive: true,
          merchantName: "Sample Supermarket",
          name: "Backfill groceries",
          operator: "contains",
          pattern: "Groceries",
          priority: 10,
        });

        const result = await runJob(pool, "backfill_rule", { ruleId });
        const database = await pool.query<{
          is_fixed_cost: boolean;
          rule_id: string | null;
          updated_at: string;
        }>(`
          SELECT
            enriched_transactions.is_fixed_cost,
            enriched_transactions.rule_id::text,
            monthly_forecasts.updated_at::text
          FROM enriched_transactions
          JOIN raw_transactions ON raw_transactions.id = enriched_transactions.raw_transaction_id
          CROSS JOIN monthly_forecasts
          WHERE raw_transactions.description = 'Groceries sample'
            AND monthly_forecasts.year_month = '2026-05'
        `);

        expect(result).toMatchObject({
          forecastYearMonth: "2026-05",
          skippedManualCount: 0,
          updatedCount: 1,
        });
        expect(database.rows[0]).toMatchObject({
          is_fixed_cost: true,
          rule_id: String(ruleId),
        });
        expect(database.rows[0]?.updated_at).not.toContain("2026-05-01 00:00:00");
      });
    } finally {
      await container.stop();
    }
  }, 120_000);
});
