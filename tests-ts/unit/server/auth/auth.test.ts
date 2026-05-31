import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { loadConfig } from "../../../../src/server/config/env.ts";
import { createApp } from "../../../../src/server/http/app.ts";

vi.mock("openid-client", () => ({
  authorizationCodeGrant: vi.fn(async () => ({
    access_token: "access-token",
    claims: () => ({
      email: "allowed@example.test",
      groups: ["finance-app"],
      name: "Allowed User",
      sub: "oidc-user",
    }),
  })),
  buildAuthorizationUrl: vi.fn((_configuration, params: Record<string, string>) => {
    const url = new URL("https://issuer.example.test/authorize");
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
    return url;
  }),
  calculatePKCECodeChallenge: vi.fn(async () => "pkce-challenge"),
  discovery: vi.fn(async () => ({})),
  fetchUserInfo: vi.fn(async () => undefined),
  randomPKCECodeVerifier: vi.fn(() => "pkce-verifier"),
  randomState: vi.fn(() => "oidc-state"),
}));

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
    expect(response.body.csrfToken).toEqual(expect.any(String));
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

  it("redirects browser routes into the OIDC login flow", async () => {
    const config = loadConfig({
      ALLOWED_EMAILS: "allowed@example.test",
      OIDC_ENABLED: "true",
      OIDC_CLIENT_ID: "client-id",
      OIDC_CLIENT_SECRET: "client-secret",
      OIDC_ISSUER_URL: "https://issuer.example.test",
      OIDC_REDIRECT_URI: "https://app.example.test/auth/callback",
      SECRET_KEY: "test-secret-with-length",
    });

    await request(createApp(config))
      .get("/")
      .expect(302)
      .expect("Location", "/auth/login?returnTo=%2F");
  });

  it("allows disabled local login routes to return only to app-relative URLs", async () => {
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
    const app = createApp(config);

    await request(app)
      .get("/auth/login?returnTo=/settings")
      .expect(302)
      .expect("Location", "/settings");
    await request(app)
      .get("/auth/login?returnTo=https://evil.example.test")
      .expect(302)
      .expect("Location", "/");
  });

  it("stores allowed users after an OIDC callback", async () => {
    const config = loadConfig({
      ALLOWED_EMAILS: "allowed@example.test",
      OIDC_ENABLED: "true",
      OIDC_CLIENT_ID: "client-id",
      OIDC_CLIENT_SECRET: "client-secret",
      OIDC_ISSUER_URL: "https://issuer.example.test",
      OIDC_REDIRECT_URI: "https://app.example.test/auth/callback",
      SECRET_KEY: "test-secret-with-length",
    });
    const agent = request.agent(createApp(config));

    await agent.get("/auth/login?returnTo=/settings").expect(302);
    await agent
      .get("/auth/callback?code=ok&state=oidc-state")
      .expect(302)
      .expect("Location", "/settings");
    const profile = await agent.get("/api/me").expect(200);

    expect(profile.body.user).toMatchObject({
      email: "allowed@example.test",
      name: "Allowed User",
      sub: "oidc-user",
    });
  });

  it("requires CSRF tokens for state-changing browser requests", async () => {
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
    const app = createApp(config);
    const agent = request.agent(app);
    const session = await agent.get("/api/me").expect(200);

    await agent.post("/api/exports").expect(403);
    await agent.post("/api/exports").set("x-csrf-token", session.body.csrfToken).expect(200);
  });

  it("requires CSRF tokens for logout", async () => {
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
    const agent = request.agent(createApp(config));
    const session = await agent.get("/api/me").expect(200);

    await agent.post("/logout").expect(403);
    await agent.post("/logout").set("x-csrf-token", session.body.csrfToken).expect(204);
  });
});
