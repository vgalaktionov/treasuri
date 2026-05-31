import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { describe, expect, it } from "vitest";

import { runMigrations } from "../../../src/server/db/migrations.ts";
import { withPool } from "../../../src/server/db/pool.ts";
import { updateMonthlyForecast } from "../../../src/server/jobs/handlers.ts";
import { loadSampleData } from "../../../src/server/sample/load.ts";

describe("monthly forecast update", () => {
  it("uses synced balance, paid fixed costs, upcoming recurring costs, variable baseline, and confidence blockers", async () => {
    const container = await new PostgreSqlContainer("postgres:16-alpine").start();

    try {
      await withPool(container.getConnectionUri(), async (pool) => {
        await runMigrations(pool);
        await loadSampleData(pool);
        await pool.query(`
          INSERT INTO app_settings (key, value_json)
          VALUES
            ('fixed_costs_upcoming', '{"amount":"100.00","currency":"EUR"}'::jsonb),
            ('variable_baseline_3m', '{"amount":"700.00","currency":"EUR"}'::jsonb),
            ('variable_baseline_6m', '{"amount":"650.00","currency":"EUR"}'::jsonb)
          ON CONFLICT (key) DO UPDATE SET value_json = EXCLUDED.value_json
        `);
        await pool.query(`
          INSERT INTO recurring_series (
            name, cadence, amount_mode, expected_amount, amount_tolerance,
            expected_day_of_month, next_expected_date, confidence, is_confirmed, is_active
          )
          VALUES ('Sample Utilities', 'monthly', 'fixed', 50.00, 0, 30, '2026-05-30', 1, true, true)
        `);

        const result = await updateMonthlyForecast(pool, new Date("2026-05-28T12:00:00Z"));
        const forecast = await pool.query<{
          confidence: string;
          explanation_json: Record<string, string>;
          fixed_costs_paid: string;
          fixed_costs_upcoming: string;
          predicted_variable_remaining: string;
          safe_to_spend: string;
          variable_spent: string;
        }>(`
          SELECT
            fixed_costs_paid::text,
            fixed_costs_upcoming::text,
            variable_spent::text,
            predicted_variable_remaining::text,
            safe_to_spend::text,
            confidence,
            explanation_json
          FROM monthly_forecasts
          WHERE year_month = '2026-05'
        `);

        expect(result).toMatchObject({ confidence: "low", reviewCount: 1 });
        expect(forecast.rows[0]).toMatchObject({
          confidence: "low",
          fixed_costs_paid: "1450.00",
          fixed_costs_upcoming: "150.00",
          predicted_variable_remaining: "503.60",
          safe_to_spend: "824.85",
          variable_spent: "196.40",
        });
        expect(forecast.rows[0]?.explanation_json).toMatchObject({
          confidence_reasons: "review_burden",
          pace_projection: "217.44",
          predicted_month_end: "700.00",
          variable_baseline_3m: "700.00",
        });
      });
    } finally {
      await container.stop();
    }
  }, 120_000);
});
