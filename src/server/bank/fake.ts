import fs from "node:fs";
import { sampleAccountIban, sampleTransactions } from "../sample/data.ts";
import { createAbnBankProvider } from "./abn/index.ts";
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

export function createDefaultBankProvider(env: NodeJS.ProcessEnv = process.env): BankProvider {
  const provider = env.BANK_PROVIDER ?? "fake";

  if (provider === "fake") {
    return createFakeBankProvider();
  }

  if (provider === "abn" || provider === "abn_amro") {
    return createAbnBankProvider(
      {
        accountIban: requiredEnv(env, "ABN_ACCOUNT_IBAN"),
        cardNumber: readSecret(env, "ABN_CARD_NUMBER"),
        softToken: readSecret(env, "ABN_SOFT_TOKEN"),
      },
      {
        maxPages: readPositiveInteger(env.ABN_SYNC_PAGES ?? "1", "ABN_SYNC_PAGES"),
      },
    );
  }

  throw new Error(`Unsupported bank provider: ${provider}`);
}

function readSecret(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  const file = env[`${name}_FILE`];

  if (value && file) {
    throw new Error(`${name} and ${name}_FILE cannot both be set`);
  }
  if (value) {
    return value;
  }
  if (file) {
    return fs.readFileSync(file, "utf8").trim();
  }
  throw new Error(`${name} is required when BANK_PROVIDER=abn`);
}

function requiredEnv(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required when BANK_PROVIDER=abn`);
  }
  return value;
}

function readPositiveInteger(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}
