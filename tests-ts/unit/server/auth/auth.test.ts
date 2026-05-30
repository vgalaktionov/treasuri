import request from "supertest";
import { describe, expect, it } from "vitest";

import { loadConfig } from "../../../../src/server/config/env.ts";
import { createApp } from "../../../../src/server/http/app.ts";

describe("auth middleware", () => {
  it("allows the configured local OIDC test profile", async () => {
    const config = loadConfig({
      ALLOWED_EMAILS: "dev-user@example.test",
      OIDC_ENABLED: "false",
      OIDC_TESTING_PROFILE_JSON: JSON.stringify({
        email: "dev-user@example.test",
        groups: ["finance-app"],
        sub: "dev-user",
      }),
      SECRET_KEY: "test-secret-with-length",
    });

    const response = await request(createApp(config)).get("/api/me").expect(200);

    expect(response.body.user).toMatchObject({
      email: "dev-user@example.test",
      sub: "dev-user",
    });
  });

  it("denies a test profile outside the allowed email list", async () => {
    const config = loadConfig({
      ALLOWED_EMAILS: "allowed@example.test",
      OIDC_ENABLED: "false",
      OIDC_TESTING_PROFILE_JSON: JSON.stringify({
        email: "blocked@example.test",
        groups: [],
        sub: "blocked-user",
      }),
      SECRET_KEY: "test-secret-with-length",
    });

    await request(createApp(config)).get("/api/me").expect(403);
  });

  it("leaves health checks public", async () => {
    const config = loadConfig({
      ALLOWED_EMAILS: "allowed@example.test",
      OIDC_ENABLED: "true",
      OIDC_CLIENT_ID: "client-id",
      OIDC_CLIENT_SECRET: "client-secret",
      OIDC_ISSUER_URL: "https://issuer.example.test",
      OIDC_REDIRECT_URI: "https://app.example.test/auth/callback",
      SECRET_KEY: "test-secret-with-length",
    });

    await request(createApp(config)).get("/healthz").expect(200);
  });

  it("requires a session when real OIDC is enabled", async () => {
    const config = loadConfig({
      ALLOWED_EMAILS: "allowed@example.test",
      OIDC_ENABLED: "true",
      OIDC_CLIENT_ID: "client-id",
      OIDC_CLIENT_SECRET: "client-secret",
      OIDC_ISSUER_URL: "https://issuer.example.test",
      OIDC_REDIRECT_URI: "https://app.example.test/auth/callback",
      SECRET_KEY: "test-secret-with-length",
    });

    await request(createApp(config)).get("/api/me").expect(401);
  });
});
