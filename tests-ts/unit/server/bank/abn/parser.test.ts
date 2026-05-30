import { describe, expect, it } from "vitest";

import { parseMutationsListResponse } from "../../../../../src/server/bank/abn/index.ts";

const accountIban = "NL25ABNA0123456789";

describe("parseMutationsListResponse", () => {
  it("maps the known mutationsList shape to the bank provider contract", () => {
    const parsed = parseMutationsListResponse(
      {
        mutationsList: {
          clearCacheIndicator: false,
          lastMutationKey: "2026-05-24-17.07.47.900000",
          mutations: [
            {
              actions: [],
              mutation: {
                accountNumber: accountIban,
                accountNumberType: "IBAN",
                amount: -2000.99,
                balanceAfterMutation: 3.5,
                bookDate: 1780264800000,
                counterAccountName: "Jumbo Amsterdam,PAS123",
                counterAccountNumber: "",
                counterAccountType: "UNSTRUCTURED_BBAN",
                currencyIsoCode: "EUR",
                debitCredit: "DEBIT",
                descriptionLines: [
                  "BEA, Apple Pay                  ",
                  "Jumbo Amsterdam, Pas 123            ",
                  "NR:3NZ308, 30.05.26/13:54       ",
                  "HEDEL",
                ],
                mutationCode: "321",
                paymentStatus: "DEFAULT",
                sourceInquiryNumber: "0530135401918619",
                statusTimestamp: -62135773200000,
                transactionDate: 1780092000000,
                transactionTimestamp: "20260530135401600",
                valueDate: 1780092000000,
              },
            },
          ],
        },
      },
      accountIban,
    );

    expect(parsed.lastMutationKey).toBe("2026-05-24-17.07.47.900000");
    expect(parsed.clearCacheIndicator).toBe(false);
    expect(parsed.mutations[0]).toMatchObject({
      accountIban,
      amount: "-2000.99",
      balanceAfterMutation: "3.50",
      bookingDate: "2026-06-01",
      counterpartyName: "Jumbo Amsterdam,PAS123",
      currency: "EUR",
      description: "BEA, Apple Pay Jumbo Amsterdam, Pas 123 NR:3NZ308, 30.05.26/13:54 HEDEL",
      providerTransactionId: `${accountIban}:0530135401918619`,
      valueDate: "2026-05-30",
    });
    expect(parsed.mutations[0]?.counterpartyAccount).toBeUndefined();
  });

  it("uses a stable fallback source hash when sourceInquiryNumber is missing", () => {
    const first = parseMutationsListResponse(
      fallbackPayload(["Sample   line", "Second"]),
      accountIban,
    );
    const second = parseMutationsListResponse(
      fallbackPayload([" Sample line ", "Second"]),
      accountIban,
    );

    expect(first.mutations[0]?.providerTransactionId).toBeUndefined();
    expect(first.mutations[0]?.sourceHash).toMatch(/^[a-f0-9]{64}$/);
    expect(second.mutations[0]?.sourceHash).toBe(first.mutations[0]?.sourceHash);
    expect(first.mutations[0]?.counterpartyAccount).toBeUndefined();
  });

  it("surfaces clearCacheIndicator so provider cursor state can be reset", () => {
    const parsed = parseMutationsListResponse(
      {
        mutationsList: {
          clearCacheIndicator: true,
          lastMutationKey: "ignored-after-reset",
          mutations: [],
        },
      },
      accountIban,
    );

    expect(parsed).toMatchObject({
      clearCacheIndicator: true,
      lastMutationKey: "ignored-after-reset",
      mutations: [],
    });
  });
});

function fallbackPayload(descriptionLines: string[]) {
  return {
    mutationsList: {
      clearCacheIndicator: false,
      lastMutationKey: "cursor",
      mutations: [
        {
          mutation: {
            accountNumber: accountIban,
            accountNumberType: "IBAN",
            amount: "-42.10",
            bookDate: "2026-05-27",
            counterAccountName: "Sample Counterparty",
            counterAccountNumber: "   ",
            currencyIsoCode: "EUR",
            descriptionLines,
            transactionTimestamp: "20260527120000000",
          },
        },
      ],
    },
  };
}
