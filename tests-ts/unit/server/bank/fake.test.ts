import fs from "node:fs";
import os from "node:os";
import path from "node:path";

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

  it("builds the in-repo ABN provider from env and mounted secret files", () => {
    const secretDir = fs.mkdtempSync(path.join(os.tmpdir(), "treasuri-abn-"));
    const cardFile = path.join(secretDir, "card");
    const tokenFile = path.join(secretDir, "token");
    fs.writeFileSync(cardFile, "123\n");
    fs.writeFileSync(tokenFile, "12345\n");

    const provider = createDefaultBankProvider({
      ABN_ACCOUNT_IBAN: "NL25ABNA0123456789",
      ABN_CARD_NUMBER_FILE: cardFile,
      ABN_SOFT_TOKEN_FILE: tokenFile,
      ABN_SYNC_PAGES: "2",
      BANK_PROVIDER: "abn",
    });

    expect(provider.provider).toBe("abn_amro");
  });

  it("requires ABN credentials when BANK_PROVIDER=abn", () => {
    expect(() =>
      createDefaultBankProvider({
        ABN_ACCOUNT_IBAN: "NL25ABNA0123456789",
        BANK_PROVIDER: "abn",
      }),
    ).toThrow("ABN_CARD_NUMBER");
  });
});
