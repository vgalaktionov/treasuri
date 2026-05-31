import { PostgreSqlContainer } from "@testcontainers/postgresql";
import request from "supertest";
import { describe, expect, it } from "vitest";

import { runMigrations } from "../../../src/server/db/migrations.ts";
import { withPool } from "../../../src/server/db/pool.ts";
import { createApp } from "../../../src/server/http/app.ts";
import { loadSampleData } from "../../../src/server/sample/load.ts";

describe("management API", () => {
  it("filters transactions and persists manual transaction edits", async () => {
    const { app, container, restore } = await appWithSampleData();
    try {
      const { agent, csrf } = await csrfAgent(app);
      const filtered = await agent
        .get("/api/transactions?query=dog&month=2026-05&kind=spending&minAmount=80&maxAmount=90")
        .expect(200);
      const transaction = filtered.body.transactions[0];
      const groceries = filtered.body.categories.find(
        (category: { name: string }) => category.name === "Groceries",
      );

      expect(filtered.body.transactions).toHaveLength(1);
      expect(filtered.body.summary).toMatchObject({
        excludedTotal: "0.00",
        incomeTotal: "0.00",
        netTotal: "-89.95",
        outflowTotal: "89.95",
        reviewCount: 0,
        totalCount: 1,
      });
      expect(transaction.description).toBe("Dog food sample");
      await agent
        .patch(`/api/transactions/${transaction.id}`)
        .set("x-csrf-token", csrf)
        .send({
          categoryId: groceries.id,
          createAlias: true,
          flags: {
            isExcludedFromBudget: true,
            isOneOff: true,
            isSavings: false,
            isTransfer: false,
          },
          merchantName: "Dog Supplies",
        })
        .expect(200);

      const updated = await agent.get("/api/transactions?query=dog").expect(200);
      const alias = await withPool(container.getConnectionUri(), async (pool) =>
        pool.query<{ count: string }>(
          "SELECT count(*) FROM merchant_aliases WHERE match_text = 'Sample Pet Care'",
        ),
      );

      expect(updated.body.transactions[0].categoryName).toBe("Groceries");
      expect(updated.body.transactions[0].merchant).toBe("Dog Supplies");
      expect(updated.body.transactions[0].needsReview).toBe(false);
      expect(updated.body.transactions[0].flags).toContain("one-off");
      expect(updated.body.transactions[0].flags).toContain("excluded");
      expect(alias.rows[0]?.count).toBe("1");
    } finally {
      await restore();
      await container.stop();
    }
  }, 120_000);

  it("exposes raw transaction details", async () => {
    const { app, container, restore } = await appWithSampleData();
    try {
      const transactions = await request(app).get("/api/transactions?query=review").expect(200);
      const transaction = transactions.body.transactions[0];
      const raw = await request(app).get(`/api/transactions/${transaction.id}/raw`).expect(200);

      expect(raw.body.details).toEqual(
        expect.arrayContaining([
          { label: "Provider", value: "fake" },
          { label: "Currency", value: "EUR" },
        ]),
      );
      expect(raw.body.payloadJson).toContain("sample");
    } finally {
      await restore();
      await container.stop();
    }
  }, 120_000);

  it("reports category budget averages and forecast exclusions", async () => {
    const { app, container, restore } = await appWithSampleData();
    try {
      const budgets = await request(app).get("/api/category-budgets").expect(200);
      const dog = budgets.body.categories.find(
        (category: { name: string }) => category.name === "Dog",
      );
      const savings = budgets.body.categories.find(
        (category: { name: string }) => category.name === "Savings",
      );

      expect(budgets.body.yearMonth).toBe("2026-05");
      expect(budgets.body.totals.currentMonth).toBe("1604.30");
      expect(budgets.body.totals.suggestedBudget).toBe("1610.00");
      expect(dog.currentMonth).toBe("89.95");
      expect(dog.suggestedBudget).toBe("90.00");
      expect(dog.includedInForecast).toBe(true);
      expect(dog.status).toBe("watch");
      expect(savings.includedInForecast).toBe(false);
      expect(savings.excludedFromForecast).toBe("500.00");
    } finally {
      await restore();
      await container.stop();
    }
  }, 120_000);

  it("previews rules and does not overwrite manual overrides when applying", async () => {
    const { app, container, restore } = await appWithSampleData();
    try {
      const { agent, csrf } = await csrfAgent(app);
      const transactions = await agent.get("/api/transactions?query=dog").expect(200);
      const transaction = transactions.body.transactions[0];
      const groceries = transactions.body.categories.find(
        (category: { name: string }) => category.name === "Groceries",
      );

      await agent
        .patch(`/api/transactions/${transaction.id}`)
        .set("x-csrf-token", csrf)
        .send({ categoryId: groceries.id, merchantName: transaction.merchant })
        .expect(200);
      const preview = await agent
        .post("/api/rules/preview")
        .set("x-csrf-token", csrf)
        .send({
          categoryId: groceries.id,
          field: "description",
          name: "Dog rule",
          pattern: "Dog food",
        })
        .expect(200);
      const created = await agent
        .post("/api/rules")
        .set("x-csrf-token", csrf)
        .send({
          categoryId: groceries.id,
          field: "description",
          name: "Dog rule",
          pattern: "Dog food",
        })
        .expect(200);
      const applied = await agent
        .post(`/api/rules/${created.body.ruleId}/apply`)
        .set("x-csrf-token", csrf)
        .expect(200);

      expect(preview.body.matches).toHaveLength(0);
      expect(preview.body.skippedManualCount).toBe(1);
      expect(applied.body.updatedCount).toBe(0);
      expect(applied.body.skippedManualCount).toBe(1);
    } finally {
      await restore();
      await container.stop();
    }
  }, 120_000);

  it("drafts a rule from transaction context with preview counts", async () => {
    const { app, container, restore } = await appWithSampleData();
    try {
      const { agent } = await csrfAgent(app);
      const transactions = await agent.get("/api/transactions?query=groceries").expect(200);
      const transaction = transactions.body.transactions[0];
      const drafted = await agent
        .get(`/api/rules/draft-from-transaction/${transaction.id}`)
        .expect(200);

      expect(drafted.body.transactionId).toBe(transaction.id);
      expect(drafted.body.rule.name).toBe("Classify Sample Supermarket");
      expect(drafted.body.rule.field).toBe("counterparty_name");
      expect(drafted.body.rule.pattern).toBe("Sample Supermarket");
      expect(drafted.body.rule.categoryId).toBe(transaction.categoryId);
      expect(drafted.body.preview.matchCount).toBeGreaterThan(0);
      expect(drafted.body.preview.alreadyCorrectCount).toBeGreaterThan(0);
    } finally {
      await restore();
      await container.stop();
    }
  }, 120_000);

  it("edits rules, toggles active state, and reports history preview counts", async () => {
    const { app, container, restore } = await appWithSampleData();
    try {
      const { agent, csrf } = await csrfAgent(app);
      const transactions = await agent.get("/api/transactions?query=groceries").expect(200);
      const groceries = transactions.body.categories.find(
        (category: { name: string }) => category.name === "Groceries",
      );
      const created = await agent
        .post("/api/rules")
        .set("x-csrf-token", csrf)
        .send({
          categoryId: groceries.id,
          field: "merchant",
          flags: { setIsFixedCost: true },
          isActive: true,
          merchantName: "Sample Supermarket",
          name: "Supermarket merchant",
          operator: "contains",
          pattern: "Supermarket",
          priority: 25,
        })
        .expect(200);

      const listed = await agent.get("/api/rules").expect(200);
      const rule = listed.body.rules.find(
        (item: { id: number }) => item.id === created.body.ruleId,
      );

      expect(rule.priority).toBe(25);
      expect(rule.matchCount).toBe(1);
      expect(rule.wouldChangeCount).toBe(1);
      expect(rule.flags).toContain("fixed");

      await agent
        .put(`/api/rules/${created.body.ruleId}`)
        .set("x-csrf-token", csrf)
        .send({
          categoryId: groceries.id,
          field: "description",
          flags: { setIsSavings: true },
          isActive: true,
          merchantName: "Sample Supermarket",
          name: "Groceries description",
          operator: "starts_with",
          pattern: "Groceries",
          priority: 5,
        })
        .expect(200);
      await agent
        .patch(`/api/rules/${created.body.ruleId}/active`)
        .set("x-csrf-token", csrf)
        .send({ isActive: false })
        .expect(200);
      const inactiveApply = await agent
        .post(`/api/rules/${created.body.ruleId}/apply`)
        .set("x-csrf-token", csrf)
        .expect(200);

      expect(inactiveApply.body.updatedCount).toBe(0);
    } finally {
      await restore();
      await container.stop();
    }
  }, 120_000);

  it("edits, confirms, and disables recurring series", async () => {
    const { app, container, restore } = await appWithSampleData();
    try {
      const { agent, csrf } = await csrfAgent(app);
      const recurring = await agent.get("/api/recurring").expect(200);
      const detected = recurring.body.series.find(
        (series: { isConfirmed: boolean }) => !series.isConfirmed,
      );
      const subscriptions = recurring.body.categories.find(
        (category: { name: string }) => category.name === "Subscriptions",
      );

      expect(recurring.body.series[0].confidence).toBeDefined();
      expect(subscriptions).toBeDefined();
      expect(recurring.body.series[0].linkedTransactions).toBeInstanceOf(Array);
      expect(
        recurring.body.series.some(
          (series: { linkedTransactions: unknown[]; name: string }) =>
            series.name === "Sample Rent" && series.linkedTransactions.length > 0,
        ),
      ).toBe(true);
      await agent
        .put(`/api/recurring/${detected.id}`)
        .set("x-csrf-token", csrf)
        .send({
          categoryId: subscriptions.id,
          expectedAmount: "19.99",
          expectedDayOfMonth: 16,
          name: "Edited Streaming",
          nextExpectedDate: "2026-06-16",
        })
        .expect(200);
      const edited = await agent.get("/api/recurring").expect(200);
      const editedSeries = edited.body.series.find(
        (series: { id: number }) => series.id === detected.id,
      );

      expect(editedSeries).toMatchObject({
        amount: "19.99",
        categoryId: subscriptions.id,
        categoryName: "Subscriptions",
        expectedDayOfMonth: 16,
        isConfirmed: true,
        name: "Edited Streaming",
        nextExpectedDate: "2026-06-16",
      });
      expect(editedSeries.warnings).not.toContain("New recurring payment detected");
      await agent
        .post(`/api/recurring/${detected.id}/confirm`)
        .set("x-csrf-token", csrf)
        .expect(200);
      const confirmed = await agent.get("/api/recurring").expect(200);
      expect(
        confirmed.body.series.find((series: { id: number }) => series.id === detected.id)
          .isConfirmed,
      ).toBe(true);

      await agent
        .post(`/api/recurring/${detected.id}/disable`)
        .set("x-csrf-token", csrf)
        .expect(200);
      const disabled = await agent.get("/api/recurring").expect(200);
      expect(disabled.body.series.some((series: { id: number }) => series.id === detected.id)).toBe(
        false,
      );
    } finally {
      await restore();
      await container.stop();
    }
  }, 120_000);
});

async function csrfAgent(app: ReturnType<typeof createApp>) {
  const agent = request.agent(app);
  const response = await agent.get("/api/me").expect(200);
  return { agent, csrf: response.body.csrfToken as string };
}

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
