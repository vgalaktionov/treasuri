import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { Client } from "pg";
import { describe, expect, it } from "vitest";

describe("Testcontainers Postgres", () => {
  it("starts an isolated Postgres and accepts SQL", async () => {
    const container = await new PostgreSqlContainer("postgres:16-alpine").start();

    try {
      const client = new Client({
        connectionString: container.getConnectionUri(),
      });
      await client.connect();

      try {
        const result = await client.query<{ value: number }>("SELECT 1::int AS value");
        expect(result.rows).toEqual([{ value: 1 }]);
      } finally {
        await client.end();
      }
    } finally {
      await container.stop();
    }
  }, 120_000);
});
