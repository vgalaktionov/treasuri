import fs from "node:fs/promises";
import path from "node:path";
import type pg from "pg";

import { sql, toQuery } from "./sql.ts";

export type Migration = {
  path: string;
  sql: string;
  version: string;
};

export type MigrationResult = {
  applied: string[];
  skipped: string[];
};

export async function runMigrations(pool: pg.Pool, migrationsDir = "migrations") {
  const migrations = await readMigrations(migrationsDir);
  const client = await pool.connect();

  try {
    await ensureSchemaMigrations(client);
    const appliedVersions = await getAppliedVersions(client);
    const result: MigrationResult = { applied: [], skipped: [] };

    for (const migration of migrations) {
      if (appliedVersions.has(migration.version)) {
        result.skipped.push(migration.version);
        continue;
      }

      await applyMigration(client, migration);
      result.applied.push(migration.version);
    }

    return result;
  } finally {
    client.release();
  }
}

export async function readMigrations(migrationsDir: string): Promise<Migration[]> {
  const filenames = (await fs.readdir(migrationsDir))
    .filter((filename) => filename.endsWith(".sql"))
    .sort();

  return Promise.all(
    filenames.map(async (filename) => {
      const migrationPath = path.join(migrationsDir, filename);
      return {
        path: migrationPath,
        sql: await fs.readFile(migrationPath, "utf8"),
        version: path.basename(filename, ".sql"),
      };
    }),
  );
}

async function ensureSchemaMigrations(client: pg.PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}

async function getAppliedVersions(client: pg.PoolClient): Promise<Set<string>> {
  const result = await client.query<{ version: string }>(
    toQuery(sql`SELECT version FROM schema_migrations ORDER BY version`),
  );

  return new Set(result.rows.map((row) => row.version));
}

async function applyMigration(client: pg.PoolClient, migration: Migration): Promise<void> {
  try {
    await client.query("BEGIN");
    await client.query(migration.sql);
    await client.query(
      toQuery(sql`INSERT INTO schema_migrations (version) VALUES (${migration.version})`),
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw new Error(`Migration ${migration.version} failed`, { cause: error });
  }
}
