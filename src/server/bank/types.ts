export type BankMutation = {
  accountIban: string;
  amount: string;
  balanceAfterMutation?: string;
  bookingDate: string;
  counterpartyAccount?: string;
  counterpartyName?: string;
  currency: string;
  description: string;
  providerTransactionId?: string;
  rawPayload: unknown;
  sourceHash?: string;
  valueDate?: string;
};

export type BankProvider = {
  fetchMutations: () => Promise<readonly BankMutation[]>;
  getSyncMetadata?: () => Record<string, unknown>;
  provider: string;
};

export type SyncResult = {
  newTransactionCount: number;
  provider: string;
  syncRunId: number;
  updatedTransactionCount: number;
};
