import { PostgreSqlContainer } from "@testcontainers/postgresql";
import request from "supertest";
import { describe, expect, it } from "vitest";

import { runMigrations } from "../../../src/server/db/migrations.ts";
import { withPool } from "../../../src/server/db/pool.ts";
import { createApp } from "../../../src/server/http/app.ts";
import { loadSampleData } from "../../../src/server/sample/load.ts";

describe("management API", () => {
  it("filters transactions and persists manual category edits", async () => {
    const { app, container, restore } = await appWithSampleData();
    try {
      const filtered = await request(app).get("/api/transactions?query=dog").expect(200);
      const transaction = filtered.body.transactions[0];
      const groceries = filtered.body.categories.find(
        (category: { name: string }) => category.name === "Groceries",
      );

      expect(filtered.body.transactions).toHaveLength(1);
      expect(transaction.description).toBe("Dog food sample");
      await request(app)
        .patch(`/api/transactions/${transaction.id}`)
        .send({ categoryId: groceries.id })
        .expect(200);

      const updated = await request(app).get("/api/transactions?query=dog").expect(200);

      expect(updated.body.transactions[0].categoryName).toBe("Groceries");
      expect(updated.body.transactions[0].needsReview).toBe(false);
    } finally {
      await restore();
      await container.stop();
    }
  }, 60_000);

  it("previews rules and does not overwrite manual overrides when applying", async () => {
    const { app, container, restore } = await appWithSampleData();
    try {
      const transactions = await request(app).get("/api/transactions?query=dog").expect(200);
      const transaction = transactions.body.transactions[0];
      const groceries = transactions.body.categories.find(
        (category: { name: string }) => category.name === "Groceries",
      );

      await request(app)
        .patch(`/api/transactions/${transaction.id}`)
        .send({ categoryId: groceries.id })
        .expect(200);
      const preview = await request(app)
        .post("/api/rules/preview")
        .send({
          categoryId: groceries.id,
          field: "description",
          name: "Dog rule",
          pattern: "Dog food",
        })
        .expect(200);
      const created = await request(app)
        .post("/api/rules")
        .send({
          categoryId: groceries.id,
          field: "description",
          name: "Dog rule",
          pattern: "Dog food",
        })
        .expect(200);
      const applied = await request(app)
        .post(`/api/rules/${created.body.ruleId}/apply`)
        .expect(200);

      expect(preview.body.matches).toHaveLength(0);
      expect(preview.body.skippedManualCount).toBe(1);
      expect(applied.body.updatedCount).toBe(0);
      expect(applied.body.skippedManualCount).toBe(1);
    } finally {
      await restore();
      await container.stop();
    }
  }, 60_000);
});

async function appWithSampleData() {
  const container = await new PostgreSqlContainer("postgres:16-alpine").start();
  const previousDatabaseUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = container.getConnectionUri();
  await withPool(container.getConnectionUri(), async (pool) => {
    await runMigrations(pool);
    await loadSampleData(pool);
  });
  return {
    app: createApp(),
    container,
    restore: async () => {
      if (previousDatabaseUrl === undefined) {
        delete process.env.DATABASE_URL;
      } else {
        process.env.DATABASE_URL = previousDatabaseUrl;
      }
    },
  };
}
