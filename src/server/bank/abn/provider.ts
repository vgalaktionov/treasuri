import type { BankMutation, BankProvider } from "../types.ts";
import { AbnClient, type AbnCredentials } from "./client.ts";

export type AbnBankProviderOptions = {
  client?: Pick<AbnClient, "fetchMutations">;
  maxPages?: number;
  startCursor?: string;
};

export type AbnSyncMetadata = {
  clearCacheIndicator: boolean;
  cursorReset: boolean;
  lastMutationKey: string | undefined;
};

export class AbnBankProvider implements BankProvider {
  readonly provider = "abn_amro";
  private readonly client: Pick<AbnClient, "fetchMutations">;
  private readonly startCursor: string | undefined;
  private metadata: AbnSyncMetadata = {
    clearCacheIndicator: false,
    cursorReset: false,
    lastMutationKey: undefined,
  };

  constructor(credentials: AbnCredentials, options: AbnBankProviderOptions = {}) {
    this.client =
      options.client ??
      new AbnClient(
        credentials,
        options.maxPages === undefined ? {} : { maxPages: options.maxPages },
      );
    this.startCursor = options.startCursor;
  }

  async fetchMutations(): Promise<readonly BankMutation[]> {
    const result = await this.client.fetchMutations(this.startCursor);
    this.metadata = {
      clearCacheIndicator: result.clearCacheIndicator,
      cursorReset: result.clearCacheIndicator,
      lastMutationKey: result.clearCacheIndicator ? undefined : result.lastMutationKey,
    };
    return result.mutations;
  }

  getSyncMetadata(): Record<string, unknown> {
    return {
      clear_cache_indicator: this.metadata.clearCacheIndicator,
      cursor_reset: this.metadata.cursorReset,
      last_mutation_key: this.metadata.lastMutationKey ?? null,
    };
  }
}

export function createAbnBankProvider(
  credentials: AbnCredentials,
  options: AbnBankProviderOptions = {},
): AbnBankProvider {
  return new AbnBankProvider(credentials, options);
}
