import { z } from "zod";

export const managementCategorySchema = z.object({ id: z.number(), name: z.string() });

export const transactionListItemSchema = z.object({
  amount: z.string(),
  bookingDate: z.string(),
  categoryId: z.number().nullable(),
  categoryName: z.string().nullable(),
  description: z.string(),
  id: z.number(),
  merchant: z.string(),
  needsReview: z.boolean(),
});

export const transactionsResponseSchema = z.object({
  categories: z.array(managementCategorySchema),
  transactions: z.array(transactionListItemSchema),
});

export const categoryUpdateRequestSchema = z.object({ categoryId: z.number() });

export const rulePreviewRequestSchema = z.object({
  categoryId: z.number(),
  field: z.enum(["description", "counterparty_name"]),
  name: z.string().min(1),
  pattern: z.string().min(1),
});

export const rulePreviewResponseSchema = z.object({
  matches: z.array(transactionListItemSchema),
  skippedManualCount: z.number(),
});

export const ruleCreateResponseSchema = z.object({ ruleId: z.number() });

export const ruleApplyResponseSchema = z.object({
  skippedManualCount: z.number(),
  updatedCount: z.number(),
});

export const rulesResponseSchema = z.object({
  categories: z.array(managementCategorySchema),
  rules: z.array(
    z.object({
      categoryName: z.string().nullable(),
      field: z.string(),
      id: z.number(),
      isActive: z.boolean(),
      name: z.string(),
      pattern: z.string(),
    }),
  ),
});

export const recurringResponseSchema = z.object({
  series: z.array(
    z.object({
      amount: z.string().nullable(),
      categoryName: z.string().nullable(),
      cadence: z.string(),
      id: z.number(),
      isConfirmed: z.boolean(),
      name: z.string(),
      nextExpectedDate: z.string().nullable(),
    }),
  ),
});

export type RulePreviewRequest = z.infer<typeof rulePreviewRequestSchema>;
export type TransactionsResponse = z.infer<typeof transactionsResponseSchema>;
