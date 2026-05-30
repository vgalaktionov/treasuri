import { AbnAuthenticationError, AbnPayloadError, AbnTransportError } from "./errors.ts";
import { type AbnParsedMutations, parseMutationsListResponse } from "./parser.ts";
import {
  ABN_BASE_URL,
  ABN_SERVICE_VERSION_HEADER,
  ABN_START_URL,
  COMMON_USER_AGENTS_URL,
  calculateResponse,
} from "./protocol.ts";

export type AbnCredentials = {
  accountIban: string;
  cardNumber: string;
  softToken: string;
};

export type AbnClientOptions = {
  fetch: typeof fetch;
  maxPages: number;
};

export class AbnClient {
  private readonly fetchImpl: typeof fetch;
  private readonly maxPages: number;
  private userAgent: string | undefined;

  constructor(
    private readonly credentials: AbnCredentials,
    options: Partial<AbnClientOptions> = {},
  ) {
    if (options.maxPages !== undefined && options.maxPages < 1) {
      throw new AbnPayloadError("ABN maxPages must be at least 1");
    }
    this.fetchImpl = options.fetch ?? fetch;
    this.maxPages = options.maxPages ?? 1;
  }

  async fetchMutations(startCursor?: string): Promise<AbnParsedMutations> {
    await this.login();

    const mutations: AbnParsedMutations["mutations"] = [];
    let lastMutationKey = startCursor;
    let responseCursor: string | undefined;
    let clearCacheIndicator = false;

    for (let page = 0; page < this.maxPages; page += 1) {
      const response = await this.fetchMutationPage(lastMutationKey);
      mutations.push(...response.mutations);
      responseCursor = response.lastMutationKey;
      clearCacheIndicator = clearCacheIndicator || response.clearCacheIndicator;

      if (
        response.clearCacheIndicator ||
        !response.lastMutationKey ||
        response.lastMutationKey === lastMutationKey
      ) {
        break;
      }
      lastMutationKey = response.lastMutationKey;
    }

    return { clearCacheIndicator, lastMutationKey: responseCursor, mutations };
  }

  private async login(): Promise<void> {
    await this.loadUserAgent();
    await this.getJson(ABN_START_URL, { expectJson: false });
    const challengePayload = await this.getJson(`${ABN_BASE_URL}/session/loginchallenge`, {
      query: loginBaseParams(this.credentials),
    });
    const loginChallenge = readLoginChallenge(challengePayload);
    const response = calculateResponse(
      loginChallenge.challenge,
      loginChallenge.userId,
      this.credentials.softToken,
    );
    const loginResponse = await this.fetchImpl(`${ABN_BASE_URL}/session/loginresponse`, {
      body: JSON.stringify({
        ...loginBaseParams(this.credentials),
        challengeDeviceDetails: loginChallenge.challengeDeviceDetails,
        challengeHandle: loginChallenge.challengeHandle,
        response,
      }),
      headers: {
        "content-type": "application/json",
        ...ABN_SERVICE_VERSION_HEADER,
        ...this.defaultHeaders(),
      },
      method: "PUT",
    });

    if (!loginResponse.ok) {
      throw new AbnAuthenticationError();
    }
  }

  private async fetchMutationPage(
    lastMutationKey: string | undefined,
  ): Promise<AbnParsedMutations> {
    const payload = await this.getJson(
      `${ABN_BASE_URL}/mutations/${encodeURIComponent(this.credentials.accountIban)}`,
      {
        headers: ABN_SERVICE_VERSION_HEADER,
        query: {
          accountNumber: this.credentials.accountIban,
          includeActions: "EXTENDED",
          ...(lastMutationKey ? { lastMutationKey } : {}),
        },
      },
    );

    return parseMutationsListResponse(payload, this.credentials.accountIban);
  }

  private async loadUserAgent(): Promise<void> {
    try {
      const payload = await this.getJson(COMMON_USER_AGENTS_URL);
      if (Array.isArray(payload) && typeof payload[0] === "string") {
        this.userAgent = payload[0];
      }
    } catch {
      this.userAgent = undefined;
    }
  }

  private async getJson(
    url: string,
    options: {
      expectJson?: boolean;
      headers?: Record<string, string>;
      query?: Record<string, string | number>;
    } = {},
  ): Promise<unknown> {
    const response = await this.fetchImpl(withQuery(url, options.query), {
      headers: { ...this.defaultHeaders(), ...options.headers },
      method: "GET",
    });

    if (!response.ok) {
      throw new AbnTransportError("ABN request failed");
    }
    if (options.expectJson === false) {
      return undefined;
    }
    return response.json();
  }

  private defaultHeaders(): Record<string, string> {
    return this.userAgent ? { "user-agent": this.userAgent } : {};
  }
}

function loginBaseParams(credentials: AbnCredentials): Record<string, string | number> {
  return {
    accessToolUsage: "SOFTTOKEN",
    accountNumber: Number(credentials.accountIban.slice(8)),
    appId: "SIMPLE_BANKING",
    cardNumber: Number(credentials.cardNumber),
  };
}

function readLoginChallenge(payload: unknown): {
  challenge: string;
  challengeDeviceDetails: unknown;
  challengeHandle: unknown;
  userId: string;
} {
  if (!isRecord(payload) || !isRecord(payload.loginChallenge)) {
    throw new AbnPayloadError("ABN login challenge response is invalid");
  }
  const challenge = payload.loginChallenge;
  return {
    challenge: requireString(challenge.challenge, "ABN login challenge is missing challenge"),
    challengeDeviceDetails: challenge.challengeDeviceDetails,
    challengeHandle: challenge.challengeHandle,
    userId: requireString(challenge.userId, "ABN login challenge is missing userId"),
  };
}

function withQuery(url: string, query: Record<string, string | number> | undefined): string {
  if (!query) {
    return url;
  }
  const parsed = new URL(url);
  for (const [key, value] of Object.entries(query)) {
    parsed.searchParams.set(key, String(value));
  }
  return parsed.toString();
}

function requireString(value: unknown, message: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new AbnPayloadError(message);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
