import { z } from "zod";

export const reviewCategorySchema = z.object({
  id: z.number(),
  name: z.string(),
});

export const reviewTransactionSchema = z.object({
  amount: z.string(),
  bookingDate: z.string(),
  categoryId: z.number().nullable(),
  categoryName: z.string().nullable(),
  classificationMethod: z.string().nullable(),
  counterpartyName: z.string().nullable(),
  currency: z.string(),
  description: z.string(),
  flags: z.array(z.string()).default([]),
  id: z.number(),
  merchantName: z.string(),
  similarCount: z.number().default(0),
});

export const reviewInboxResponseSchema = z.object({
  categories: z.array(reviewCategorySchema),
  reviewCount: z.number(),
  reviewImpact: z.string(),
  transactions: z.array(reviewTransactionSchema),
});

export const reviewActionRequestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("accept") }),
  z.object({
    action: z.literal("change"),
    applySimilar: z.boolean().default(false),
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
    next: z.enum(["rule-preview", "stay"]).default("stay"),
  }),
  z.object({
    action: z.literal("exclude"),
    applySimilar: z.boolean().default(false),
    categoryId: z.number().optional(),
    createAlias: z.boolean().default(false),
    merchantName: z.string().optional(),
  }),
]);

export const reviewActionResponseSchema = z.object({
  correctedCount: z.number().default(1),
  correctedTransactionIds: z.array(z.number()).default([]),
  reviewCount: z.number(),
  reviewImpact: z.string(),
  ruleDraft: z
    .object({
      categoryId: z.number(),
      field: z.literal("counterparty_name"),
      flags: z.object({
        setIsExcludedFromBudget: z.boolean(),
        setIsFixedCost: z.boolean(),
        setIsIncome: z.boolean(),
        setIsSavings: z.boolean(),
        setIsTransfer: z.boolean(),
      }),
      isActive: z.literal(true),
      merchantName: z.string().optional(),
      name: z.string(),
      operator: z.literal("contains"),
      pattern: z.string(),
      priority: z.number(),
    })
    .nullable()
    .default(null),
  similarCount: z.number().default(0),
  transactionId: z.number(),
});

export type ReviewActionRequest = z.infer<typeof reviewActionRequestSchema>;
export type ReviewActionResponse = z.infer<typeof reviewActionResponseSchema>;
export type ReviewInboxResponse = z.infer<typeof reviewInboxResponseSchema>;
