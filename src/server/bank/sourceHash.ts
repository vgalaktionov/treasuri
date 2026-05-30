import crypto from "node:crypto";

import type { BankMutation } from "./types.ts";

export function sourceHashForMutation(mutation: BankMutation): string {
  if (mutation.sourceHash) {
    return mutation.sourceHash;
  }

  const stableParts = [
    mutation.accountIban,
    mutation.providerTransactionId ?? "",
    mutation.bookingDate,
    mutation.valueDate ?? "",
    mutation.amount,
    mutation.currency,
    mutation.counterpartyName ?? "",
    mutation.counterpartyAccount ?? "",
    normalizeDescription(mutation.description),
  ];

  return crypto.createHash("sha256").update(stableParts.join("\u001f")).digest("hex");
}

function normalizeDescription(description: string): string {
  return description.trim().replace(/\s+/g, " ").toLowerCase();
}
