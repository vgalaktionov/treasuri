import { describe, expect, it } from "vitest";

import {
  calculateSafeToSpend,
  daysLeftInMonth,
} from "../../../../src/server/forecast/calculator.ts";

describe("calculateSafeToSpend", () => {
  it("uses synced current liquid balance in the PRD formula", () => {
    const result = calculateSafeToSpend({
      currentLiquidBalance: "4000.00",
      daysLeftInMonth: 6,
      expectedIncomeRemaining: "1000.00",
      fixedCostsUpcoming: "620.00",
      predictedVariableRemaining: "760.00",
      safetyBuffer: "1000.00",
      targetSavingsRemaining: "1000.00",
    });

    expect(result.safeToSpend).toBe("1620.00");
    expect(result.safePerDay).toBe("270.00");
    expect(result.explanation.formula).toContain("synced_current_liquid_balance");
  });

  it("keeps negative safe-to-spend visible", () => {
    const result = calculateSafeToSpend({
      currentLiquidBalance: "500.00",
      daysLeftInMonth: 4,
      expectedIncomeRemaining: "0.00",
      fixedCostsUpcoming: "620.00",
      predictedVariableRemaining: "760.00",
      safetyBuffer: "1000.00",
      targetSavingsRemaining: "1000.00",
    });

    expect(result.safeToSpend).toBe("-2880.00");
    expect(result.safePerDay).toBe("-720.00");
  });
});

describe("daysLeftInMonth", () => {
  it("includes today", () => {
    expect(daysLeftInMonth(new Date("2026-05-26T12:00:00Z"))).toBe(6);
    expect(daysLeftInMonth(new Date("2026-05-31T12:00:00Z"))).toBe(1);
  });
});
