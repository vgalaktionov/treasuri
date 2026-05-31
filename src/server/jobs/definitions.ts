import { z } from "zod";

export const jobPayloadSchemas = {
  backfill_rule: z.object({ ruleId: z.number() }),
  classify_transactions: z.object({}),
  detect_recurring: z.object({}),
  generate_xlsx_export: z.object({
    createdBy: z.string().optional(),
    runId: z.number().optional(),
  }),
  normalize_transactions: z.object({}),
  sync_now: z.object({}),
  sync_abn_transactions: z.object({}),
  update_monthly_forecast: z.object({}),
} as const;

export type JobName = keyof typeof jobPayloadSchemas;

export function parseJobPayload(name: JobName, payload: unknown) {
  return jobPayloadSchemas[name].parse(payload);
}
