import { PgBoss } from "pg-boss";

import { type JobName, parseJobPayload } from "./definitions.ts";

export async function enqueueJob(
  connectionString: string,
  name: JobName,
  payload: unknown = {},
): Promise<string> {
  const boss = new PgBoss({ connectionString });
  boss.on("error", () => undefined);
  await boss.start();
  try {
    await boss.createQueue(name);
    const id = await boss.send(name, parseJobPayload(name, payload));
    if (!id) {
      throw new Error("pg-boss did not return a job id");
    }
    return id;
  } finally {
    await boss.stop();
  }
}
