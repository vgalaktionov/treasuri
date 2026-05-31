import type pg from "pg";

import { createDefaultBankProvider } from "../bank/fake.ts";
import { syncBankTransactions } from "../bank/sync.ts";

export async function runSyncNow(pool: pg.Pool) {
  return syncBankTransactions(pool, createDefaultBankProvider());
}
