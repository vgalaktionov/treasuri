import type pg from "pg";

import { createDefaultBankProvider } from "../bank/fake.ts";
import { syncBankTransactions } from "../bank/sync.ts";
import { classifyPendingTransactions } from "../classify/service.ts";
import { updateMonthlyForecast } from "../forecast/service.ts";
import { detectRecurringCandidates } from "../management/recurring.ts";
import { applyRule } from "../management/rules.ts";
import { createXlsxExport } from "../operations/exportService.ts";
import { runSyncNow } from "../operations/syncService.ts";
import { normalizePendingTransactions } from "../transactions/normalize.ts";
import { type JobName, jobPayloadSchemas } from "./definitions.ts";

export const registeredJobs = Object.keys(jobPayloadSchemas) as JobName[];

export async function runJob(pool: pg.Pool, name: JobName, payload: unknown) {
  switch (name) {
    case "sync_abn_transactions":
      jobPayloadSchemas.sync_abn_transactions.parse(payload);
      return syncBankTransactions(pool, createDefaultBankProvider());
    case "normalize_transactions":
      jobPayloadSchemas.normalize_transactions.parse(payload);
      return normalizeTransactions(pool);
    case "sync_now":
      jobPayloadSchemas.sync_now.parse(payload);
      return runSyncNow(pool);
    case "classify_transactions":
      jobPayloadSchemas.classify_transactions.parse(payload);
      return classifyPendingTransactions(pool);
    case "detect_recurring":
      jobPayloadSchemas.detect_recurring.parse(payload);
      return detectRecurringCandidates(pool);
    case "update_monthly_forecast":
      jobPayloadSchemas.update_monthly_forecast.parse(payload);
      return updateMonthlyForecast(pool);
    case "generate_xlsx_export": {
      const parsed = jobPayloadSchemas.generate_xlsx_export.parse(payload);
      return createXlsxExport(pool, parsed.createdBy ?? null);
    }
    case "backfill_rule": {
      const parsed = jobPayloadSchemas.backfill_rule.parse(payload);
      return applyRule(pool, parsed.ruleId);
    }
  }
}

async function normalizeTransactions(pool: pg.Pool) {
  const client = await pool.connect();
  try {
    return { normalizedCount: await normalizePendingTransactions(client) };
  } finally {
    client.release();
  }
}
