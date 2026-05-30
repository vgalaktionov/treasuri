export type ClassificationSource =
  | "manual_override"
  | "rule"
  | "merchant_alias"
  | "historical_similarity"
  | "llm";

export type ClassificationCandidate = {
  categoryId: number;
  confidence: number;
  merchantId?: number;
  reason: string;
  source: ClassificationSource;
};

const sourcePriority: Record<ClassificationSource, number> = {
  manual_override: 500,
  rule: 400,
  merchant_alias: 300,
  historical_similarity: 200,
  llm: 100,
};

export function selectClassificationCandidate(
  candidates: readonly ClassificationCandidate[],
): ClassificationCandidate | null {
  return (
    [...candidates].sort((left, right) => {
      const priorityDelta = sourcePriority[right.source] - sourcePriority[left.source];
      if (priorityDelta !== 0) {
        return priorityDelta;
      }
      return right.confidence - left.confidence;
    })[0] ?? null
  );
}
