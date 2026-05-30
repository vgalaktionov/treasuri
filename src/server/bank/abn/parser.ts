import crypto from "node:crypto";

import type { BankMutation } from "../types.ts";
import { AbnPayloadError } from "./errors.ts";

export type AbnParsedMutations = {
  clearCacheIndicator: boolean;
  lastMutationKey: string | undefined;
  mutations: BankMutation[];
};

export function parseMutationsListResponse(
  payload: unknown,
  fallbackAccountIban: string,
): AbnParsedMutations {
  if (Array.isArray(payload)) {
    return {
      clearCacheIndicator: false,
      lastMutationKey: undefined,
      mutations: payload.map((item) => parseMutation(expectRecord(item), fallbackAccountIban)),
    };
  }

  const response = expectRecord(payload);
  const mutationsList = response.mutationsList;
  if (mutationsList !== undefined) {
    const list = expectRecord(mutationsList);
    return {
      clearCacheIndicator: readBoolean(list.clearCacheIndicator),
      lastMutationKey: readOptionalString(list.lastMutationKey),
      mutations: readMutationItems(list.mutations).map((item) => {
        const record = expectRecord(item);
        return parseMutation(expectRecord(record.mutation ?? record), fallbackAccountIban);
      }),
    };
  }

  for (const key of ["mutations", "accountMutations", "transactions", "items"]) {
    const value = response[key];
    if (Array.isArray(value)) {
      return {
        clearCacheIndicator: false,
        lastMutationKey: readOptionalString(
          response.lastMutationKey ?? response.nextMutationKey ?? response.nextKey,
        ),
        mutations: value.map((item) => parseMutation(expectRecord(item), fallbackAccountIban)),
      };
    }
  }

  throw new AbnPayloadError("ABN mutations response did not contain mutationsList");
}

export function parseMutation(
  payload: Record<string, unknown>,
  fallbackAccountIban: string,
): BankMutation {
  const accountIban =
    readOptionalString(payload.accountNumberType) === "IBAN"
      ? requireString(payload.accountNumber, "ABN mutation accountNumber is missing")
      : fallbackAccountIban;
  const sourceInquiryNumber = readOptionalString(payload.sourceInquiryNumber);
  const descriptionLines = readDescriptionLines(payload);
  const counterpartyAccount = readOptionalString(payload.counterAccountNumber);
  const providerTransactionId = sourceInquiryNumber
    ? `${accountIban}:${sourceInquiryNumber}`
    : undefined;
  const sourceHash = providerTransactionId
    ? undefined
    : fallbackSourceHash({
        accountNumber: accountIban,
        amount: payload.amount,
        bookDate: payload.bookDate ?? payload.bookingDate,
        counterAccountName: payload.counterAccountName,
        counterAccountNumber: counterpartyAccount,
        currencyIsoCode: payload.currencyIsoCode ?? payload.currency ?? payload.currencyCode,
        descriptionLines,
        transactionTimestamp: payload.transactionTimestamp,
      });

  const mutation: BankMutation = {
    accountIban,
    amount: readDecimalString(
      payload.amount ?? payload.transactionAmount ?? payload.mutationAmount,
    ),
    bookingDate: readRequiredDate(
      payload.bookDate ?? payload.bookingDate ?? payload.transactionDate,
    ),
    currency: requireCurrency(payload.currencyIsoCode ?? payload.currency ?? payload.currencyCode),
    description: descriptionLines.join(" "),
    rawPayload: payload,
  };

  const balanceAfterMutation = readOptionalDecimalString(payload.balanceAfterMutation);
  const counterpartyName = readOptionalString(
    payload.counterAccountName ??
      payload.counterpartyName ??
      payload.counterPartyName ??
      payload.contraAccountName,
  );
  const valueDate = readOptionalDate(payload.valueDate ?? payload.valutaDate);

  if (balanceAfterMutation) {
    mutation.balanceAfterMutation = balanceAfterMutation;
  }
  if (counterpartyAccount) {
    mutation.counterpartyAccount = counterpartyAccount;
  }
  if (counterpartyName) {
    mutation.counterpartyName = counterpartyName;
  }
  if (providerTransactionId) {
    mutation.providerTransactionId = providerTransactionId;
  }
  if (sourceHash) {
    mutation.sourceHash = sourceHash;
  }
  if (valueDate) {
    mutation.valueDate = valueDate;
  }

  return mutation;
}

function readMutationItems(value: unknown): unknown[] {
  if (!Array.isArray(value)) {
    throw new AbnPayloadError("ABN mutationsList.mutations must be an array");
  }
  return value;
}

function readDescriptionLines(payload: Record<string, unknown>): string[] {
  const direct =
    payload.description ?? payload.remittanceInformation ?? payload.mutationDescription;
  if (direct !== undefined) {
    const text = readDescriptionValue(direct);
    if (text.length > 0) {
      return text;
    }
  }

  const lines = payload.descriptionLines ?? payload.remarks;
  const text = readDescriptionValue(lines);
  if (text.length === 0) {
    throw new AbnPayloadError("ABN mutation description is missing");
  }
  return text;
}

function readDescriptionValue(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((line) => String(line).trim()).filter(Boolean);
  }
  const text = readOptionalString(value);
  return text ? [text] : [];
}

function readRequiredDate(value: unknown): string {
  const date = readOptionalDate(value);
  if (!date) {
    throw new AbnPayloadError("ABN mutation date is missing");
  }
  return date;
}

function readOptionalDate(value: unknown): string | undefined {
  if (value === null || value === undefined || value === "") {
    return undefined;
  }
  if (typeof value === "number") {
    return dateInAmsterdam(value);
  }
  const text = String(value).trim();
  if (/^\d{13}$/.test(text)) {
    return dateInAmsterdam(Number(text));
  }
  if (/^\d{8}$/.test(text)) {
    return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) {
    return text.slice(0, 10);
  }
  throw new AbnPayloadError(`ABN mutation date is invalid: ${text}`);
}

function dateInAmsterdam(epochMillis: number): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Europe/Amsterdam",
    year: "numeric",
  }).formatToParts(new Date(epochMillis));
  const part = (type: string) => parts.find((item) => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function readOptionalDecimalString(value: unknown): string | undefined {
  if (value === null || value === undefined || value === "") {
    return undefined;
  }
  return readDecimalString(value);
}

function readDecimalString(value: unknown): string {
  const amountValue = readAmountValue(value);
  const amount = Number(amountValue);
  if (!Number.isFinite(amount)) {
    throw new AbnPayloadError("ABN mutation amount is missing or invalid");
  }
  return amount.toFixed(2);
}

function readAmountValue(value: unknown): unknown {
  if (isRecord(value)) {
    return value.value ?? value.amount;
  }
  return value;
}

function requireCurrency(value: unknown): string {
  const currency = readOptionalString(value ?? "EUR")?.toUpperCase();
  if (currency?.length !== 3) {
    throw new AbnPayloadError("ABN mutation currency must be a three-letter code");
  }
  return currency;
}

function fallbackSourceHash(input: {
  accountNumber: string;
  amount: unknown;
  bookDate: unknown;
  counterAccountName: unknown;
  counterAccountNumber: string | undefined;
  currencyIsoCode: unknown;
  descriptionLines: string[];
  transactionTimestamp: unknown;
}): string {
  return crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        accountNumber: input.accountNumber,
        amount: readDecimalString(input.amount),
        bookDate: readOptionalDate(input.bookDate),
        counterAccountName: readOptionalString(input.counterAccountName),
        counterAccountNumber: input.counterAccountNumber ?? "",
        currencyIsoCode: requireCurrency(input.currencyIsoCode),
        descriptionLines: input.descriptionLines.map((line) => line.trim().replace(/\s+/g, " ")),
        transactionTimestamp: readOptionalString(input.transactionTimestamp),
      }),
    )
    .digest("hex");
}

function readBoolean(value: unknown): boolean {
  return value === true;
}

function requireString(value: unknown, message: string): string {
  const text = readOptionalString(value);
  if (!text) {
    throw new AbnPayloadError(message);
  }
  return text;
}

function readOptionalString(value: unknown): string | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  const text = String(value).trim();
  return text.length > 0 ? text : undefined;
}

function expectRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new AbnPayloadError("ABN mutation item must be a JSON object");
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
