import { sampleAccountIban, sampleTransactions } from "../sample/data.ts";

export type FakeBankMutation = {
  accountIban: string;
  amount: string;
  balanceAfterMutation: string;
  bookingDate: string;
  counterpartyName: string;
  description: string;
  sourceHash: string;
};

export type FakeBankProvider = {
  provider: "fake";
  fetchMutations: () => Promise<readonly FakeBankMutation[]>;
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
        description: transaction.description,
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
