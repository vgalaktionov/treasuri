import { z } from "zod";

export const settingsResponseSchema = z.object({
  baselineMonths: z.number(),
  safetyBuffer: z.string(),
  targetMonthlySavings: z.string(),
});

export const settingsUpdateSchema = settingsResponseSchema;

export const exportRunSchema = z.object({
  createdAt: z.string(),
  fileId: z.number().nullable(),
  id: z.number(),
  status: z.string(),
});

export const exportsResponseSchema = z.object({ exports: z.array(exportRunSchema) });

export const exportCreateResponseSchema = z.object({
  exportRunId: z.number(),
  fileId: z.number(),
});

export const statusResponseSchema = z.object({
  database: z.string(),
  failedJobs: z.array(
    z.object({ error: z.string().nullable(), name: z.string(), startedAt: z.string() }),
  ),
  latestSync: z.object({ provider: z.string(), status: z.string() }).nullable(),
  secrets: z.literal("redacted"),
});

export type SettingsResponse = z.infer<typeof settingsResponseSchema>;
export type ExportCreateResponse = z.infer<typeof exportCreateResponseSchema>;
export type ExportsResponse = z.infer<typeof exportsResponseSchema>;
export type StatusResponse = z.infer<typeof statusResponseSchema>;
