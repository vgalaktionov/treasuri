import { z } from "zod";

const llmSuggestionSchema = z.object({
  categoryName: z.string().min(1),
  confidence: z.number().min(0).max(1),
  merchantName: z.string().min(1).optional(),
  reason: z.string().min(1),
});

export type LlmClassificationSuggestion = {
  categoryId: number;
  categoryName: string;
  confidence: number;
  merchantName: string | undefined;
  reason: string;
};

export function parseLlmSuggestion(
  payload: unknown,
  allowedCategories: readonly { id: number; name: string }[],
): LlmClassificationSuggestion | null {
  const parsed = llmSuggestionSchema.safeParse(payload);
  if (!parsed.success) {
    return null;
  }

  const category = allowedCategories.find(
    (candidate) => candidate.name.toLowerCase() === parsed.data.categoryName.toLowerCase(),
  );
  if (!category) {
    return null;
  }

  return {
    categoryId: category.id,
    categoryName: category.name,
    confidence: parsed.data.confidence,
    merchantName: parsed.data.merchantName,
    reason: parsed.data.reason,
  };
}
