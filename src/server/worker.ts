import { PgBoss } from "pg-boss";

import { createPool } from "./db/pool.ts";
import { registeredJobs, runJob } from "./jobs/handlers.ts";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is required for the worker");
}

const pool = createPool(connectionString);
const boss = new PgBoss({ connectionString });

boss.on("error", (error) => {
  console.error("pg-boss worker error", error);
});

await boss.start();

for (const name of registeredJobs) {
  await boss.createQueue(name);
  await boss.work(name, async (jobs) => {
    const results = [];
    for (const job of jobs) {
      results.push(await runJob(pool, name, job.data));
    }
    return { processed: results.length, results };
  });
}

console.log(`treasuri worker started with queues: ${registeredJobs.join(", ")}`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    await boss.stop({ graceful: true, timeout: 10_000 });
    await pool.end();
    process.exit(0);
  });
}
