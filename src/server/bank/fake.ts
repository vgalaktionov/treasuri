import { sampleAccountIban, sampleTransactions } from "../sample/data.ts";
import type { BankMutation, BankProvider } from "./types.ts";

export type FakeBankProvider = BankProvider & {
  provider: "fake";
  fetchMutations: () => Promise<readonly BankMutation[]>;
};

export function createFakeBankProvider(): FakeBankProvider {
  return {
    provider: "fake",
    async fetchMutations() {
      return sampleTransactions.map((transaction, index) => ({
        accountIban: sampleAccountIban,
        amount: transaction.amount,
        balanceAfterMutation: String(4000 - index * 100),
        bookingDate: transaction.bookingDate,
        counterpartyName: transaction.counterpartyName,
        currency: "EUR",
        description: transaction.description,
        providerTransactionId: transaction.sourceHash,
        rawPayload: { source: "fake", sourceHash: transaction.sourceHash },
        sourceHash: transaction.sourceHash,
      }));
    },
  };
}

export function createDefaultBankProvider(env: NodeJS.ProcessEnv = process.env): FakeBankProvider {
  const provider = env.BANK_PROVIDER ?? "fake";

  if (provider !== "fake") {
    throw new Error(`Unsupported bank provider for this slice: ${provider}`);
  }

  return createFakeBankProvider();
}
