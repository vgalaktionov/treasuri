import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { describe, expect, it } from "vitest";

import { classifyPendingTransactions } from "../../../src/server/classify/service.ts";
import { runMigrations } from "../../../src/server/db/migrations.ts";
import { withPool } from "../../../src/server/db/pool.ts";
import { loadSampleData } from "../../../src/server/sample/load.ts";

describe("classification service", () => {
  it("classifies pending transactions with deterministic merchant aliases", async () => {
    const container = await new PostgreSqlContainer("postgres:16-alpine").start();
    const databaseUrl = container.getConnectionUri();
    try {
      const result = await withPool(databaseUrl, async (pool) => {
        await runMigrations(pool);
        await loadSampleData(pool);
        await pool.query(`
          WITH target_category AS (
            SELECT id FROM categories WHERE name = 'Groceries'
          ),
          inserted_merchant AS (
            INSERT INTO merchants (name, normalized_name, default_category_id)
            SELECT 'Needs Review Store', 'needs review store', id FROM target_category
            ON CONFLICT (normalized_name) DO UPDATE
              SET default_category_id = EXCLUDED.default_category_id
            RETURNING id
          )
          INSERT INTO merchant_aliases (merchant_id, match_text, match_type, priority)
          SELECT id, 'Needs review sample', 'contains', 10 FROM inserted_merchant
        `);

        const classified = await classifyPendingTransactions(pool);
        const classifiedTransaction = await pool.query<{
          category_name: string;
          classification_method: string;
          merchant_name: string;
          needs_review: boolean;
        }>(`
          SELECT categories.name AS category_name,
            merchants.name AS merchant_name,
            enriched_transactions.classification_method,
            enriched_transactions.needs_review
          FROM enriched_transactions
          JOIN raw_transactions ON raw_transactions.id = enriched_transactions.raw_transaction_id
          LEFT JOIN categories ON categories.id = enriched_transactions.category_id
          LEFT JOIN merchants ON merchants.id = enriched_transactions.merchant_id
          WHERE raw_transactions.description = 'Needs review sample'
        `);

        return { classified, row: classifiedTransaction.rows[0] };
      });

      expect(result.classified.classifiedCount).toBe(1);
      expect(result.row).toEqual({
        category_name: "Groceries",
        classification_method: "merchant_alias",
        merchant_name: "Needs Review Store",
        needs_review: false,
      });
    } finally {
      await container.stop();
    }
  }, 120_000);
});
