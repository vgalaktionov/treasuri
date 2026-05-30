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
  counterpartyName: z.string().nullable(),
  currency: z.string(),
  description: z.string(),
  id: z.number(),
});

export const reviewInboxResponseSchema = z.object({
  categories: z.array(reviewCategorySchema),
  reviewCount: z.number(),
  transactions: z.array(reviewTransactionSchema),
});

export const reviewActionRequestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("accept") }),
  z.object({ action: z.literal("change"), categoryId: z.number() }),
  z.object({ action: z.literal("exclude"), categoryId: z.number().optional() }),
]);

export const reviewActionResponseSchema = z.object({
  reviewCount: z.number(),
  transactionId: z.number(),
});

export type ReviewActionRequest = z.infer<typeof reviewActionRequestSchema>;
export type ReviewActionResponse = z.infer<typeof reviewActionResponseSchema>;
export type ReviewInboxResponse = z.infer<typeof reviewInboxResponseSchema>;
