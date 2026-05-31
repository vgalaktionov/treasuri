import { z } from "zod";

export const managementCategorySchema = z.object({ id: z.number(), name: z.string() });

export const transactionListItemSchema = z.object({
  amount: z.string(),
  bookingDate: z.string(),
  categoryId: z.number().nullable(),
  categoryName: z.string().nullable(),
  classificationMethod: z.string().nullable().default(null),
  description: z.string(),
  flags: z.array(z.string()).default([]),
  id: z.number(),
  merchant: z.string(),
  needsReview: z.boolean(),
});

export const transactionsResponseSchema = z.object({
  categories: z.array(managementCategorySchema),
  merchants: z.array(z.string()).default([]),
  transactions: z.array(transactionListItemSchema),
});

export const transactionFiltersSchema = z.object({
  category: z.string().optional(),
  kind: z.string().optional(),
  maxAmount: z.string().optional(),
  merchant: z.string().optional(),
  minAmount: z.string().optional(),
  month: z.string().optional(),
  needsReview: z.boolean().optional(),
  query: z.string().optional(),
});

export const transactionUpdateRequestSchema = z.object({
  categoryId: z.number(),
  createAlias: z.boolean().default(false),
  flags: z
    .object({
      isExcludedFromBudget: z.boolean().default(false),
      isOneOff: z.boolean().default(false),
      isSavings: z.boolean().default(false),
      isTransfer: z.boolean().default(false),
    })
    .default({
      isExcludedFromBudget: false,
      isOneOff: false,
      isSavings: false,
      isTransfer: false,
    }),
  merchantName: z.string().optional(),
});

export const transactionRawDetailsSchema = z.object({
  amount: z.string(),
  bookingDate: z.string(),
  categoryName: z.string().nullable(),
  description: z.string(),
  details: z.array(z.object({ label: z.string(), value: z.string() })),
  id: z.number(),
  merchant: z.string(),
  payloadJson: z.string(),
});

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
export type TransactionFilters = z.infer<typeof transactionFiltersSchema>;
export type TransactionUpdateRequest = z.infer<typeof transactionUpdateRequestSchema>;
export type TransactionRawDetails = z.infer<typeof transactionRawDetailsSchema>;
export type TransactionsResponse = z.infer<typeof transactionsResponseSchema>;
