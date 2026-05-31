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

export const ruleFieldSchema = z.enum([
  "account_id",
  "amount",
  "counterparty_iban",
  "counterparty_name",
  "description",
  "merchant",
]);

export const ruleOperatorSchema = z.enum([
  "amount_between",
  "contains",
  "ends_with",
  "exact",
  "regex",
  "starts_with",
]);

export const ruleFlagsSchema = z
  .object({
    setIsExcludedFromBudget: z.boolean().default(false),
    setIsFixedCost: z.boolean().default(false),
    setIsIncome: z.boolean().default(false),
    setIsSavings: z.boolean().default(false),
    setIsTransfer: z.boolean().default(false),
  })
  .default({
    setIsExcludedFromBudget: false,
    setIsFixedCost: false,
    setIsIncome: false,
    setIsSavings: false,
    setIsTransfer: false,
  });

export const ruleEditorRequestSchema = z.object({
  categoryId: z.number(),
  field: ruleFieldSchema,
  flags: ruleFlagsSchema,
  isActive: z.boolean().default(true),
  merchantName: z.string().optional(),
  name: z.string().min(1),
  operator: ruleOperatorSchema.default("contains"),
  pattern: z.string().min(1),
  priority: z.number().int().min(0).default(100),
});

export const rulePreviewRequestSchema = ruleEditorRequestSchema;

export const rulePreviewResponseSchema = z.object({
  alreadyCorrectCount: z.number().default(0),
  matchCount: z.number().default(0),
  matches: z.array(transactionListItemSchema),
  skippedManualCount: z.number().default(0),
  wouldChangeCount: z.number().default(0),
});

export const ruleCreateResponseSchema = z.object({ ruleId: z.number() });

export const ruleApplyResponseSchema = z.object({
  skippedManualCount: z.number(),
  updatedCount: z.number(),
});

export const rulesResponseSchema = z.object({
  categories: z.array(managementCategorySchema),
  fields: z.array(ruleFieldSchema),
  operators: z.array(ruleOperatorSchema),
  rules: z.array(
    z.object({
      alreadyCorrectCount: z.number(),
      categoryId: z.number().nullable(),
      categoryName: z.string().nullable(),
      field: ruleFieldSchema,
      flags: z.array(z.string()),
      id: z.number(),
      isActive: z.boolean(),
      manualOverridesSkippedCount: z.number(),
      matchCount: z.number(),
      merchantName: z.string().nullable(),
      name: z.string(),
      operator: ruleOperatorSchema,
      pattern: z.string(),
      priority: z.number(),
      wouldChangeCount: z.number(),
    }),
  ),
});

export const recurringResponseSchema = z.object({
  series: z.array(
    z.object({
      amount: z.string().nullable(),
      categoryName: z.string().nullable(),
      cadence: z.string(),
      confidence: z.string().nullable().default(null),
      id: z.number(),
      isConfirmed: z.boolean(),
      name: z.string(),
      nextExpectedDate: z.string().nullable(),
      warnings: z.array(z.string()).default([]),
    }),
  ),
});

export const recurringActionResponseSchema = z.object({ ok: z.boolean() });
export const ruleActiveUpdateRequestSchema = z.object({ isActive: z.boolean() });
export type RulePreviewRequest = z.infer<typeof rulePreviewRequestSchema>;
export type RuleEditorRequest = z.infer<typeof ruleEditorRequestSchema>;
export type RulesResponse = z.infer<typeof rulesResponseSchema>;
export type RecurringResponse = z.infer<typeof recurringResponseSchema>;
export type TransactionFilters = z.infer<typeof transactionFiltersSchema>;
export type TransactionUpdateRequest = z.infer<typeof transactionUpdateRequestSchema>;
export type TransactionRawDetails = z.infer<typeof transactionRawDetailsSchema>;
export type TransactionsResponse = z.infer<typeof transactionsResponseSchema>;
