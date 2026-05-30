import { describe, expect, it } from "vitest";

import { selectClassificationCandidate } from "../../../../src/server/classify/pipeline.ts";

describe("selectClassificationCandidate", () => {
  it("keeps manual overrides above every automated signal", () => {
    const selected = selectClassificationCandidate([
      { categoryId: 2, confidence: 0.99, reason: "llm", source: "llm" },
      { categoryId: 3, confidence: 0.95, reason: "rule", source: "rule" },
      { categoryId: 1, confidence: 0.5, reason: "manual", source: "manual_override" },
    ]);

    expect(selected?.categoryId).toBe(1);
    expect(selected?.source).toBe("manual_override");
  });

  it("uses deterministic priority order before confidence", () => {
    const selected = selectClassificationCandidate([
      { categoryId: 5, confidence: 0.95, reason: "history", source: "historical_similarity" },
      { categoryId: 4, confidence: 0.8, reason: "alias", source: "merchant_alias" },
      { categoryId: 3, confidence: 0.7, reason: "rule", source: "rule" },
    ]);

    expect(selected?.categoryId).toBe(3);
    expect(selected?.source).toBe("rule");
  });
});
