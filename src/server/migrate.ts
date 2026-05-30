import { loadConfig } from "./config/env.ts";
import { runMigrations } from "./db/migrations.ts";
import { withPool } from "./db/pool.ts";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for migrations");
}

loadConfig();

const result = await withPool(databaseUrl, (pool) => runMigrations(pool));

for (const version of result.applied) {
  console.log(`applied ${version}`);
}

for (const version of result.skipped) {
  console.log(`skipped ${version}`);
}
