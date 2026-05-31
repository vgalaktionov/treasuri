import { PostgreSqlContainer } from "@testcontainers/postgresql";
import request from "supertest";
import { describe, expect, it } from "vitest";

import { runMigrations } from "../../../src/server/db/migrations.ts";
import { withPool } from "../../../src/server/db/pool.ts";
import { createApp } from "../../../src/server/http/app.ts";
import { loadSampleData } from "../../../src/server/sample/load.ts";

describe("dashboard API", () => {
  it("answers safe-to-spend from the latest synced balance snapshot", async () => {
    const container = await new PostgreSqlContainer("postgres:16-alpine").start();
    const previousDatabaseUrl = process.env.DATABASE_URL;

    try {
      process.env.DATABASE_URL = container.getConnectionUri();
      await withPool(container.getConnectionUri(), async (pool) => {
        await runMigrations(pool);
        await loadSampleData(pool);
      });

      const response = await request(createApp()).get("/api/dashboard").expect(200);

      expect(response.body.safeToSpend).toBe("98.45");
      expect(response.body.currentBalance).toMatchObject({
        amount: "3478.45",
        source: "sample",
      });
      expect(response.body.explanation.formula).toContain("synced_current_liquid_balance");
      expect(response.body.safeToday).toBe(response.body.safePerDay);
      expect(response.body.monthProgress).toMatchObject({
        elapsedDays: expect.any(Number),
        label: expect.stringContaining("days elapsed"),
        remainingDays: expect.any(Number),
        totalDays: expect.any(Number),
      });
      expect(response.body.reviewCount).toBe(1);
      expect(response.body.monthFacts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ label: "Fixed costs" }),
          expect.objectContaining({ label: "Income status", value: "Income received" }),
          expect.objectContaining({ label: "Uncategorized impact" }),
        ]),
      );
      expect(response.body.categoryPace.length).toBeGreaterThan(0);
      expect(response.body.paceSummary).toContain("Variable pace");
    } finally {
      if (previousDatabaseUrl === undefined) {
        delete process.env.DATABASE_URL;
      } else {
        process.env.DATABASE_URL = previousDatabaseUrl;
      }
      await container.stop();
    }
  }, 120_000);
});
