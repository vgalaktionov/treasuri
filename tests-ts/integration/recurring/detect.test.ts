import { PostgreSqlContainer } from "@testcontainers/postgresql";
import type pg from "pg";
import { describe, expect, it } from "vitest";

import { runMigrations } from "../../../src/server/db/migrations.ts";
import { withPool } from "../../../src/server/db/pool.ts";
import { detectRecurringCandidates } from "../../../src/server/management/recurring.ts";
import { loadSampleData } from "../../../src/server/sample/load.ts";

describe("recurring detection", () => {
  it("detects monthly candidates and links matching transactions to the series", async () => {
    const container = await new PostgreSqlContainer("postgres:16-alpine").start();
    const databaseUrl = container.getConnectionUri();

    try {
      const result = await withPool(databaseUrl, async (pool) => {
        await runMigrations(pool);
        await loadSampleData(pool);
        await insertPreviousRent(pool);

        const detected = await detectRecurringCandidates(pool);
        const linked = await pool.query<{
          fixed_count: string;
          linked_count: string;
          next_expected_date: string;
          series_name: string;
        }>(`
          SELECT recurring_series.name AS series_name,
            recurring_series.next_expected_date::text,
            count(enriched_transactions.id)::text AS linked_count,
            count(*) FILTER (WHERE enriched_transactions.is_fixed_cost)::text AS fixed_count
          FROM recurring_series
          JOIN enriched_transactions ON enriched_transactions.recurring_series_id = recurring_series.id
          WHERE recurring_series.name = 'Sample Housing'
          GROUP BY recurring_series.name, recurring_series.next_expected_date
        `);

        return { detected, linked: linked.rows[0] };
      });

      expect(result.detected.detectedCount).toBeGreaterThanOrEqual(1);
      expect(result.detected.linkedTransactionCount).toBeGreaterThanOrEqual(2);
      expect(result.linked).toMatchObject({
        fixed_count: "2",
        linked_count: "2",
        next_expected_date: "2026-06-01",
        series_name: "Sample Housing",
      });
    } finally {
      await container.stop();
    }
  }, 120_000);
});

async function insertPreviousRent(pool: pg.Pool) {
  await pool.query(`
    WITH source AS (
      SELECT accounts.id AS account_id,
        merchants.id AS merchant_id,
        categories.id AS category_id
      FROM accounts
      JOIN merchants ON merchants.name = 'Sample Housing'
      JOIN categories ON categories.name = 'Rent / Mortgage'
      WHERE accounts.provider = 'fake'
      LIMIT 1
    ),
    raw AS (
      INSERT INTO raw_transactions (
        account_id, provider, provider_transaction_id, source_hash, booking_date, value_date,
        amount, currency, counterparty_name, description, raw_payload_json
      )
      SELECT account_id, 'fake', 'sample-rent-2026-04', 'sample-rent-2026-04',
        '2026-04-01', '2026-04-01', -1450.00, 'EUR', 'Sample Housing',
        'Monthly rent sample', '{"source":"test"}'::jsonb
      FROM source
      RETURNING id
    )
    INSERT INTO enriched_transactions (
      raw_transaction_id, merchant_id, category_id, needs_review, classification_method,
      classification_confidence, classification_reason, is_fixed_cost, is_variable_cost
    )
    SELECT raw.id, source.merchant_id, source.category_id, false, 'sample', 1,
      'Previous rent for recurring detection.', true, false
    FROM raw
    CROSS JOIN source
  `);
}
