import fs from "node:fs";
import type pg from "pg";
import { sampleAccountIban, sampleTransactions } from "../sample/data.ts";
import type { AbnClient } from "./abn/index.ts";
import { createAbnBankProvider } from "./abn/index.ts";
import type { BankMutation, BankProvider } from "./types.ts";

export type FakeBankProvider = BankProvider & {
  provider: "fake";
  fetchMutations: () => Promise<readonly BankMutation[]>;
};

export type DefaultBankProviderOptions = {
  abnClient?: Pick<AbnClient, "fetchMutations">;
  startCursor?: string;
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

export function createDefaultBankProvider(
  env: NodeJS.ProcessEnv = process.env,
  options: DefaultBankProviderOptions = {},
): BankProvider {
  const provider = env.BANK_PROVIDER ?? "fake";

  if (provider === "fake") {
    return createFakeBankProvider();
  }

  if (provider === "abn" || provider === "abn_amro") {
    const providerOptions: NonNullable<Parameters<typeof createAbnBankProvider>[1]> = {
      maxPages: readPositiveInteger(env.ABN_SYNC_PAGES ?? "1", "ABN_SYNC_PAGES"),
    };
    if (options.abnClient) {
      providerOptions.client = options.abnClient;
    }
    if (options.startCursor) {
      providerOptions.startCursor = options.startCursor;
    }
    return createAbnBankProvider(
      {
        accountIban: requiredEnv(env, "ABN_ACCOUNT_IBAN"),
        cardNumber: readSecret(env, "ABN_CARD_NUMBER"),
        softToken: readSecret(env, "ABN_SOFT_TOKEN"),
      },
      providerOptions,
    );
  }

  throw new Error(`Unsupported bank provider: ${provider}`);
}

export async function createDefaultBankProviderForSync(
  pool: pg.Pool,
  env: NodeJS.ProcessEnv = process.env,
  options: Omit<DefaultBankProviderOptions, "startCursor"> = {},
): Promise<BankProvider> {
  const providerName = configuredProviderName(env);
  const startCursor = providerName === "abn_amro" ? await latestMutationCursor(pool) : undefined;
  const providerOptions: DefaultBankProviderOptions = { ...options };
  if (startCursor) {
    providerOptions.startCursor = startCursor;
  }
  return createDefaultBankProvider(env, providerOptions);
}

export function configuredProviderName(env: NodeJS.ProcessEnv = process.env): string {
  const provider = env.BANK_PROVIDER ?? "fake";
  if (provider === "fake") {
    return "fake";
  }
  if (provider === "abn" || provider === "abn_amro") {
    return "abn_amro";
  }
  throw new Error(`Unsupported bank provider: ${provider}`);
}

async function latestMutationCursor(pool: pg.Pool): Promise<string | undefined> {
  const result = await pool.query<{ last_mutation_key: string | null }>(`
    SELECT metadata_json->>'last_mutation_key' AS last_mutation_key
    FROM sync_runs
    WHERE provider = 'abn_amro'
      AND status = 'completed'
      AND metadata_json ? 'last_mutation_key'
    ORDER BY finished_at DESC NULLS LAST, id DESC
    LIMIT 1
  `);
  return result.rows[0]?.last_mutation_key ?? undefined;
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
