import crypto from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  AbnAuthenticationError,
  AbnClient,
  encodeChallengeFields,
} from "../../../../../src/server/bank/abn/index.ts";

const credentials = {
  accountIban: "NL25ABNA0123456789",
  cardNumber: "123",
  softToken: "12345",
};

describe("AbnClient", () => {
  it("uses typed authentication errors without exposing response payloads", async () => {
    const fetchMock = sequenceFetch([
      jsonResponse(["Test UA"]),
      okResponse(),
      jsonResponse({ loginChallenge: createLoginChallenge() }),
      jsonResponse({ credential: "secret-token" }, 401),
    ]);
    const client = new AbnClient(credentials, { fetch: fetchMock, maxPages: 1 });

    let error: unknown;
    try {
      await client.fetchMutations();
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(AbnAuthenticationError);
    expect(String(error)).not.toContain("secret-token");
  });

  it("constructs the mutations request with account, includeActions, and cursor params", async () => {
    const calls: string[] = [];
    const fetchMock = sequenceFetch(
      [
        jsonResponse(["Test UA"]),
        okResponse(),
        jsonResponse({ loginChallenge: createLoginChallenge() }),
        okResponse(),
        jsonResponse(mutationsPage("cursor-1", "abn-page-1")),
        jsonResponse(mutationsPage("cursor-1", "abn-page-2")),
      ],
      calls,
    );
    const client = new AbnClient(credentials, { fetch: fetchMock, maxPages: 2 });

    const result = await client.fetchMutations();

    expect(result.lastMutationKey).toBe("cursor-1");
    expect(result.mutations.map((mutation) => mutation.providerTransactionId)).toEqual([
      "NL25ABNA0123456789:abn-page-1",
      "NL25ABNA0123456789:abn-page-2",
    ]);
    expect(calls.filter((url) => url.includes("/mutations/"))).toEqual([
      "https://www.abnamro.nl/mutations/NL25ABNA0123456789?accountNumber=NL25ABNA0123456789&includeActions=EXTENDED",
      "https://www.abnamro.nl/mutations/NL25ABNA0123456789?accountNumber=NL25ABNA0123456789&includeActions=EXTENDED&lastMutationKey=cursor-1",
    ]);
  });
});

function sequenceFetch(responses: Response[], calls: string[] = []): typeof fetch {
  return async (input) => {
    const url = String(input);
    calls.push(url);
    const response = responses.shift();
    if (!response) {
      throw new Error(`Unexpected fetch call: ${url}`);
    }
    return response;
  };
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    headers: { "content-type": "application/json" },
    status,
  });
}

function okResponse(status = 200): Response {
  return new Response("", { status });
}

function createLoginChallenge() {
  const { publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 1024 });
  const jwk = publicKey.export({ format: "jwk" });
  const challenge = encodeChallengeFields(
    new Map<number, number[]>([
      [2, [1, 2, 3]],
      [3, [4, 5, 6]],
      [4, [...Buffer.from(jwk.e ?? "", "base64url")]],
      [5, [...Buffer.from(jwk.n ?? "", "base64url")]],
    ]),
  ).toString("hex");

  return {
    challenge,
    challengeDeviceDetails: { device: "test" },
    challengeHandle: "handle",
    userId: "user",
  };
}

function mutationsPage(lastMutationKey: string, sourceInquiryNumber: string) {
  return {
    mutationsList: {
      clearCacheIndicator: false,
      lastMutationKey,
      mutations: [
        {
          mutation: {
            accountNumber: credentials.accountIban,
            accountNumberType: "IBAN",
            amount: "-1.23",
            bookDate: "2026-05-24",
            currencyIsoCode: "EUR",
            descriptionLines: ["Sample"],
            sourceInquiryNumber,
          },
        },
      ],
    },
  };
}
