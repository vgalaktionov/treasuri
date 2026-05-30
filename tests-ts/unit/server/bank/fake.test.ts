import { describe, expect, it } from "vitest";

import {
  createDefaultBankProvider,
  createFakeBankProvider,
} from "../../../../src/server/bank/fake.ts";

describe("fake bank provider", () => {
  it("is the default provider for dev and test flows", () => {
    expect(createDefaultBankProvider({}).provider).toBe("fake");
    expect(createDefaultBankProvider({ BANK_PROVIDER: "fake" }).provider).toBe("fake");
  });

  it("returns deterministic review-worthy sample mutations", async () => {
    const provider = createFakeBankProvider();
    const mutations = await provider.fetchMutations();

    expect(mutations).toHaveLength(7);
    expect(mutations.map((mutation) => mutation.sourceHash)).toContain("sample-review-2026-05");
  });
});
