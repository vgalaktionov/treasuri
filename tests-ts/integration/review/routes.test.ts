import { PostgreSqlContainer } from "@testcontainers/postgresql";
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
      const inbox = await request(app).get("/api/review").expect(200);
      const transaction = inbox.body.transactions[0];

      expect(inbox.body.reviewCount).toBe(1);
      expect(transaction.description).toBe("Needs review sample");

      const groceries = inbox.body.categories.find(
        (category: { name: string }) => category.name === "Groceries",
      );
      if (!groceries) {
        throw new Error("Expected Groceries category");
      }
      const action = await request(app)
        .post(`/api/review/${transaction.id}/action`)
        .send({ action: "change", categoryId: groceries.id })
        .expect(200);
      const updated = await request(app).get("/api/review").expect(200);
      const manualOverride = await withPool(container.getConnectionUri(), (pool) =>
        pool.query<{ count: string }>(
          "SELECT count(*) FROM manual_overrides JOIN enriched_transactions ON enriched_transactions.id = manual_overrides.enriched_transaction_id WHERE enriched_transactions.classification_method = 'manual_override'",
        ),
      );

      expect(action.body.reviewCount).toBe(0);
      expect(updated.body.reviewCount).toBe(0);
      expect(updated.body.transactions).toEqual([]);
      expect(manualOverride.rows[0]?.count).toBe("1");
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
