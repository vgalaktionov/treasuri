import { z } from "zod";

export const settingsResponseSchema = z.object({
  baselineMonths: z.number(),
  fixedCostsUpcoming: z.string(),
  llmConfidenceThreshold: z.string(),
  llmEnabled: z.boolean(),
  overview: z.object({
    accounts: z.array(
      z.object({
        currency: z.string(),
        iban: z.string(),
        name: z.string(),
        provider: z.string(),
        status: z.string(),
      }),
    ),
    sync: z.object({
      lastSync: z.string(),
      lookbackDays: z.number(),
      schedule: z.string(),
    }),
    taxonomy: z.object({
      categoryCount: z.number(),
      sampleCategories: z.array(z.string()),
    }),
  }),
  safetyBuffer: z.string(),
  salaryDay: z.number(),
  syncLookbackDays: z.number(),
  targetMonthlySavings: z.string(),
  variableBaseline3m: z.string(),
  variableBaseline6m: z.string(),
});

export const settingsUpdateSchema = settingsResponseSchema.omit({ overview: true });

export const exportRunSchema = z.object({
  createdAt: z.string(),
  errorMessage: z.string().nullable(),
  exportType: z.string(),
  fileId: z.number().nullable(),
  filename: z.string().nullable(),
  finishedAt: z.string().nullable().default(null),
  id: z.number(),
  periodEnd: z.string().nullable().default(null),
  periodStart: z.string().nullable().default(null),
  sha256: z.string().nullable().default(null),
  sheetNames: z.array(z.string()).default([]),
  sizeBytes: z.number().nullable(),
  status: z.string(),
});

export const exportsResponseSchema = z.object({ exports: z.array(exportRunSchema) });

export const exportCreateResponseSchema = z.object({
  exportRunId: z.number(),
  fileId: z.number(),
});

export const syncCreateResponseSchema = z.object({
  classifiedCount: z.number().default(0),
  forecastYearMonth: z.string().nullable().default(null),
  newTransactionCount: z.number(),
  provider: z.string(),
  recurringDetectedCount: z.number().default(0),
  recurringLinkedTransactionCount: z.number().default(0),
  syncRunId: z.number(),
  updatedTransactionCount: z.number(),
});

export const statusResponseSchema = z.object({
  failedJobs: z.array(
    z.object({ error: z.string().nullable(), name: z.string(), startedAt: z.string() }),
  ),
  sections: z.array(
    z.object({
      rows: z.array(
        z.object({
          detail: z.string().nullable().optional(),
          label: z.string(),
          value: z.string(),
        }),
      ),
      title: z.string(),
    }),
  ),
  secrets: z.literal("redacted"),
});

export type SettingsResponse = z.infer<typeof settingsResponseSchema>;
export type SettingsUpdate = z.infer<typeof settingsUpdateSchema>;
export type ExportCreateResponse = z.infer<typeof exportCreateResponseSchema>;
export type ExportsResponse = z.infer<typeof exportsResponseSchema>;
export type StatusResponse = z.infer<typeof statusResponseSchema>;
export type SyncCreateResponse = z.infer<typeof syncCreateResponseSchema>;
