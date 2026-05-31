import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { describe, expect, it } from "vitest";

import { runMigrations } from "../../../src/server/db/migrations.ts";
import { withPool } from "../../../src/server/db/pool.ts";

describe("runMigrations", () => {
  it("applies SQL migrations once from a clean database", async () => {
    const container = await new PostgreSqlContainer("postgres:16-alpine").start();

    try {
      const first = await withPool(container.getConnectionUri(), (pool) => runMigrations(pool));
      const second = await withPool(container.getConnectionUri(), (pool) => runMigrations(pool));

      expect(first.applied).toEqual([
        "0001_initial",
        "0002_seed_categories",
        "0003_pgqueuer",
        "0004_classification_runtime",
        "0005_account_balance_snapshots",
      ]);
      expect(first.skipped).toEqual([]);
      expect(second.applied).toEqual([]);
      expect(second.skipped).toEqual(first.applied);
    } finally {
      await container.stop();
    }
  }, 120_000);
});
