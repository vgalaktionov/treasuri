import { z } from "zod";

export const dashboardMetricSchema = z.object({
  label: z.string(),
  value: z.string(),
});

export const currentBalanceSchema = z.object({
  asOf: z.string(),
  amount: z.string(),
  currency: z.string(),
  source: z.string(),
});

export const dashboardResponseSchema = z.object({
  confidence: z.string(),
  currentBalance: currentBalanceSchema.nullable(),
  explanation: z.record(z.string(), z.string()),
  fixedCostsUpcoming: z.string(),
  incomeReceived: z.string(),
  metrics: z.array(dashboardMetricSchema),
  projectedSavings: z.string(),
  reviewCount: z.number(),
  reviewImpact: z.string(),
  safePerDay: z.string(),
  safeToSpend: z.string(),
  topVariances: z.array(dashboardMetricSchema),
  upcomingFixedCosts: z.array(dashboardMetricSchema),
  yearMonth: z.string(),
});

export type DashboardResponse = z.infer<typeof dashboardResponseSchema>;
