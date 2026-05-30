import crypto from "node:crypto";

import { AbnPayloadError } from "./errors.ts";

export const ABN_BASE_URL = "https://www.abnamro.nl";
export const ABN_START_URL = `${ABN_BASE_URL}/portalserver/mijn-abnamro/mijn-overzicht/overzicht/index.html`;
export const ABN_SERVICE_VERSION_HEADER = { "x-aab-serviceversion": "v3" } as const;
export const COMMON_USER_AGENTS_URL =
  "https://gist.githubusercontent.com/fijimunkii/952acac988f2d25bef7e0284bc63c406/raw/190452518c6bcc856b751333a0556588da0daf45/ua.json";

export function calculateResponse(challenge: string, userId: string, password: string): string {
  const decoded = decodeChallenge(challenge);
  const modulus = decoded.get(5);
  const exponent = decoded.get(4);
  const challengePart2 = decoded.get(2);
  const challengePart3 = decoded.get(3);

  if (!modulus || !exponent || !challengePart2 || !challengePart3) {
    throw new AbnPayloadError("ABN login challenge is missing required RSA fields");
  }

  const encoded = encodeChallengeFields(
    new Map<number, number[]>([
      [1, [49]],
      [2, challengePart2],
      [3, challengePart3],
      [8, asciiBytes(userId)],
      [9, asciiBytes(password)],
    ]),
  );
  const publicKey = crypto.createPublicKey({
    format: "jwk",
    key: {
      e: base64Url(Buffer.from(exponent)),
      kty: "RSA",
      n: base64Url(Buffer.from(modulus)),
    },
  });

  return crypto
    .publicEncrypt({ key: publicKey, padding: crypto.constants.RSA_PKCS1_PADDING }, encoded)
    .toString("hex");
}

export function decodeChallenge(challenge: string): Map<number, number[]> {
  const bytes = [...Buffer.from(challenge, "hex")];
  const decoded = new Map<number, number[]>();
  let cursor = 0;

  while (cursor < bytes.length) {
    const key = bytes[cursor];
    const high = bytes[cursor + 1];
    const low = bytes[cursor + 2];
    if (key === undefined || high === undefined || low === undefined) {
      throw new AbnPayloadError("ABN login challenge has truncated field header");
    }

    const size = (high << 8) + low;
    decoded.set(key, bytes.slice(cursor + 3, cursor + 3 + size));
    cursor += 3 + size;
  }

  return decoded;
}

export function encodeChallengeFields(fields: Map<number, number[]>): Buffer {
  const bytes: number[] = [];

  for (const [key, value] of [...fields.entries()].sort(([left], [right]) => left - right)) {
    bytes.push(key, (value.length >> 8) & 255, value.length & 255, ...value);
  }

  bytes.push(0, 0, 0);
  return Buffer.from(bytes);
}

function asciiBytes(value: string): number[] {
  return [...Buffer.from(value, "ascii")];
}

function base64Url(value: Buffer): string {
  return value.toString("base64url");
}
