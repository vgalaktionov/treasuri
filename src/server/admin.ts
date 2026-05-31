import { runMigrations } from "./db/migrations.ts";
import { withPool } from "./db/pool.ts";
import { runSyncNow } from "./operations/syncService.ts";
import { loadSampleData } from "./sample/load.ts";

const command = process.argv[2];
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for admin commands");
}

switch (command) {
  case "seed-categories": {
    await withPool(databaseUrl, (pool) => runMigrations(pool));
    console.log("categories seeded through migrations");
    break;
  }
  case "load-sample-data": {
    const result = await withPool(databaseUrl, async (pool) => {
      await runMigrations(pool);
      return loadSampleData(pool);
    });
    console.log(
      `loaded ${result.rawTransactionCount} sample transactions; ${result.reviewCount} need review`,
    );
    break;
  }
  case "sync-now": {
    const result = await withPool(databaseUrl, async (pool) => {
      await runMigrations(pool);
      return runSyncNow(pool);
    });
    console.log(
      `synced ${result.newTransactionCount} new and ${result.updatedTransactionCount} updated transactions from ${result.provider}; ` +
        `classified ${result.classifiedCount}, detected ${result.recurringDetectedCount} recurring, forecast ${result.forecastYearMonth}`,
    );
    break;
  }
  case undefined: {
    console.log("Available admin commands: seed-categories, load-sample-data, sync-now");
    break;
  }
  default:
    throw new Error(`Admin command is not implemented yet: ${command}`);
}
