import type pg from "pg";

import { createDefaultBankProviderForSync } from "../bank/fake.ts";
import { syncBankTransactions } from "../bank/sync.ts";
import { classifyPendingTransactions } from "../classify/service.ts";
import { updateMonthlyForecast } from "../forecast/service.ts";
import { detectRecurringCandidates } from "../management/recurring.ts";

export async function runSyncNow(pool: pg.Pool) {
  const sync = await syncBankTransactions(pool, await createDefaultBankProviderForSync(pool));
  const classification = await classifyPendingTransactions(pool);
  const recurring = await detectRecurringCandidates(pool);
  const forecast = await updateMonthlyForecast(pool);

  return {
    ...sync,
    classifiedCount: classification.classifiedCount,
    forecastYearMonth: forecast.yearMonth,
    recurringDetectedCount: recurring.detectedCount,
    recurringLinkedTransactionCount: recurring.linkedTransactionCount,
  };
}
