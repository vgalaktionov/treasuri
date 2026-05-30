import { describe, expect, it } from "vitest";

import { parseLlmSuggestion } from "../../../../src/server/classify/llm.ts";

const categories = [
  { id: 1, name: "Groceries" },
  { id: 2, name: "Dog" },
] as const;

describe("parseLlmSuggestion", () => {
  it("accepts strict JSON for known categories", () => {
    expect(
      parseLlmSuggestion(
        {
          categoryName: "groceries",
          confidence: 0.72,
          merchantName: "Sample Market",
          reason: "merchant match",
        },
        categories,
      ),
    ).toMatchObject({
      categoryId: 1,
      categoryName: "Groceries",
      confidence: 0.72,
    });
  });

  it("fails safely for invalid JSON shape and invented categories", () => {
    expect(
      parseLlmSuggestion({ categoryName: "Groceries", confidence: "high" }, categories),
    ).toBeNull();
    expect(
      parseLlmSuggestion(
        {
          categoryName: "Invented",
          confidence: 0.9,
          reason: "not allowed",
        },
        categories,
      ),
    ).toBeNull();
  });
});
