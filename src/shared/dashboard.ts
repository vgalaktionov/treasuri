import { z } from "zod";

export const dashboardMetricSchema = z.object({
  label: z.string(),
  value: z.string(),
});

export const monthFactSchema = z.object({
  detail: z.string(),
  label: z.string(),
  value: z.string(),
});

export const categoryPaceSchema = z.object({
  category: z.string(),
  currentMonth: z.string(),
  paceLabel: z.string(),
  status: z.enum(["empty", "ok", "over", "watch"]),
  suggestedBudget: z.string(),
});

export const currentBalanceSchema = z.object({
  asOf: z.string(),
  amount: z.string(),
  currency: z.string(),
  source: z.string(),
});

export const dashboardResponseSchema = z.object({
  categoryPace: z.array(categoryPaceSchema),
  confidence: z.string(),
  confidenceNote: z.string(),
  currentBalance: currentBalanceSchema.nullable(),
  explanation: z.record(z.string(), z.string()),
  fixedCostsUpcoming: z.string(),
  incomeReceived: z.string(),
  metrics: z.array(dashboardMetricSchema),
  monthFacts: z.array(monthFactSchema),
  paceSummary: z.string(),
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
