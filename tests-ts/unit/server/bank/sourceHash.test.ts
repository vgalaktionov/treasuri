import { describe, expect, it } from "vitest";

import { sourceHashForMutation } from "../../../../src/server/bank/sourceHash.ts";
import type { BankMutation } from "../../../../src/server/bank/types.ts";

const baseMutation: BankMutation = {
  accountIban: "NL00FAKE0123456789",
  amount: "-12.34",
  bookingDate: "2026-05-31",
  counterpartyName: "Sample Shop",
  currency: "EUR",
  description: "Sample   payment",
  rawPayload: {},
};

describe("sourceHashForMutation", () => {
  it("uses a provider-supplied source hash when present", () => {
    expect(sourceHashForMutation({ ...baseMutation, sourceHash: "provider-hash" })).toBe(
      "provider-hash",
    );
  });

  it("builds a stable hash from normalized mutation fields", () => {
    const first = sourceHashForMutation(baseMutation);
    const second = sourceHashForMutation({
      ...baseMutation,
      description: " sample payment ",
    });

    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(second).toBe(first);
  });
});
