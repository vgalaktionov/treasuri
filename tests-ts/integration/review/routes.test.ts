import { PostgreSqlContainer } from "@testcontainers/postgresql";
import type pg from "pg";
import request from "supertest";
import { describe, expect, it } from "vitest";

import { runMigrations } from "../../../src/server/db/migrations.ts";
import { withPool } from "../../../src/server/db/pool.ts";
import { createApp } from "../../../src/server/http/app.ts";
import { loadSampleData } from "../../../src/server/sample/load.ts";

describe("review API", () => {
  it("lists review transactions and applies in-place review actions", async () => {
    const container = await new PostgreSqlContainer("postgres:16-alpine").start();
    const previousDatabaseUrl = process.env.DATABASE_URL;

    try {
      process.env.DATABASE_URL = container.getConnectionUri();
      await withPool(container.getConnectionUri(), async (pool) => {
        await runMigrations(pool);
        await loadSampleData(pool);
      });

      const app = createApp();
      const { agent, csrf } = await csrfAgent(app);
      const inbox = await agent.get("/api/review").expect(200);
      const transaction = inbox.body.transactions[0];

      expect(inbox.body.reviewCount).toBe(1);
      expect(transaction.description).toBe("Needs review sample");

      const groceries = inbox.body.categories.find(
        (category: { name: string }) => category.name === "Groceries",
      );
      if (!groceries) {
        throw new Error("Expected Groceries category");
      }
      const action = await agent
        .post(`/api/review/${transaction.id}/action`)
        .set("x-csrf-token", csrf)
        .send({
          action: "change",
          categoryId: groceries.id,
          createAlias: true,
          flags: {
            isExcludedFromBudget: true,
            isOneOff: true,
            isSavings: false,
            isTransfer: false,
          },
          merchantName: "Reviewed Merchant",
          next: "rule-preview",
        })
        .expect(200);
      const updated = await agent.get("/api/review").expect(200);
      const rows = await withPool(container.getConnectionUri(), (pool) =>
        pool.query<{
          alias_count: string;
          category_name: string;
          is_excluded_from_budget: boolean;
          is_one_off: boolean;
          merchant_name: string;
          override_count: string;
        }>(
          `
            SELECT
              categories.name AS category_name,
              merchants.name AS merchant_name,
              enriched_transactions.is_one_off,
              enriched_transactions.is_excluded_from_budget,
              count(manual_overrides.id)::text AS override_count,
              count(merchant_aliases.id)::text AS alias_count
            FROM enriched_transactions
            JOIN categories ON categories.id = enriched_transactions.category_id
            LEFT JOIN merchants ON merchants.id = enriched_transactions.merchant_id
            LEFT JOIN manual_overrides
              ON manual_overrides.enriched_transaction_id = enriched_transactions.id
            LEFT JOIN merchant_aliases ON merchant_aliases.merchant_id = merchants.id
            WHERE enriched_transactions.id = $1
            GROUP BY categories.name, merchants.name, enriched_transactions.is_one_off,
              enriched_transactions.is_excluded_from_budget
          `,
          [transaction.id],
        ),
      );

      expect(action.body.reviewCount).toBe(0);
      expect(action.body.correctedCount).toBe(1);
      expect(action.body.ruleDraft.pattern).toBe("Unknown Sample Merchant");
      expect(updated.body.reviewCount).toBe(0);
      expect(updated.body.transactions).toEqual([]);
      expect(rows.rows[0]).toMatchObject({
        alias_count: "1",
        category_name: "Groceries",
        is_excluded_from_budget: true,
        is_one_off: true,
        merchant_name: "Reviewed Merchant",
        override_count: "1",
      });
    } finally {
      if (previousDatabaseUrl === undefined) {
        delete process.env.DATABASE_URL;
      } else {
        process.env.DATABASE_URL = previousDatabaseUrl;
      }
      await container.stop();
    }
  }, 60_000);

  it("applies review corrections to similar transactions", async () => {
    const container = await new PostgreSqlContainer("postgres:16-alpine").start();
    const previousDatabaseUrl = process.env.DATABASE_URL;

    try {
      process.env.DATABASE_URL = container.getConnectionUri();
      await withPool(container.getConnectionUri(), async (pool) => {
        await runMigrations(pool);
        await loadSampleData(pool);
        await insertSimilarReviewTransaction(pool);
      });

      const app = createApp();
      const { agent, csrf } = await csrfAgent(app);
      const inbox = await agent.get("/api/review").expect(200);
      const transaction = inbox.body.transactions.find(
        (item: { description: string }) => item.description === "Needs review sample",
      );
      const dog = inbox.body.categories.find(
        (category: { name: string }) => category.name === "Dog",
      );

      expect(inbox.body.reviewCount).toBe(2);
      expect(transaction.similarCount).toBe(1);
      const action = await agent
        .post(`/api/review/${transaction.id}/action`)
        .set("x-csrf-token", csrf)
        .send({
          action: "change",
          applySimilar: true,
          categoryId: dog.id,
          merchantName: "Sample Pet Care",
        })
        .expect(200);
      const updated = await agent.get("/api/review").expect(200);
      const reviewed = await withPool(container.getConnectionUri(), (pool) =>
        pool.query<{ count: string }>(
          "SELECT count(*) FROM enriched_transactions WHERE classification_method = 'manual_override' AND needs_review = false",
        ),
      );

      expect(action.body.correctedCount).toBe(2);
      expect(action.body.similarCount).toBe(1);
      expect(action.body.reviewCount).toBe(0);
      expect(updated.body.transactions).toEqual([]);
      expect(reviewed.rows[0]?.count).toBe("2");
    } finally {
      if (previousDatabaseUrl === undefined) {
        delete process.env.DATABASE_URL;
      } else {
        process.env.DATABASE_URL = previousDatabaseUrl;
      }
      await container.stop();
    }
  }, 60_000);
});

async function csrfAgent(app: ReturnType<typeof createApp>) {
  const agent = request.agent(app);
  const response = await agent.get("/api/me").expect(200);
  return { agent, csrf: response.body.csrfToken as string };
}

async function insertSimilarReviewTransaction(pool: pg.Pool) {
  await pool.query(`
    WITH raw AS (
      INSERT INTO raw_transactions (
        account_id, provider, provider_transaction_id, source_hash, booking_date, value_date,
        amount, currency, counterparty_name, description, raw_payload_json
      )
      SELECT
        accounts.id, 'fake', 'similar-review-2026-05', 'similar-review-2026-05',
        '2026-05-22', '2026-05-22', -35.00, 'EUR', 'Unknown Sample Merchant',
        'Similar needs review sample', '{"source":"test"}'::jsonb
      FROM accounts
      WHERE accounts.provider = 'fake'
      LIMIT 1
      RETURNING id
    )
    INSERT INTO enriched_transactions (
      raw_transaction_id, category_id, needs_review, classification_method,
      classification_confidence, classification_reason
    )
    SELECT raw.id, categories.id, true, 'uncategorized', 0, 'Similar test transaction.'
    FROM raw
    JOIN categories ON categories.name = 'Unknown'
  `);
}
