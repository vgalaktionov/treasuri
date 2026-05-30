import { describe, expect, it } from "vitest";

import { loadConfig } from "../../../../src/server/config/env.ts";

describe("loadConfig", () => {
  it("parses the local OIDC test profile and allowed email list", () => {
    const config = loadConfig({
      ALLOWED_EMAILS: "dev-user@example.test,other@example.test",
      OIDC_ENABLED: "false",
      OIDC_TESTING_PROFILE_JSON: JSON.stringify({
        email: "dev-user@example.test",
        groups: ["finance-app"],
        nickname: "dev-user",
        sub: "dev-user",
      }),
      SECRET_KEY: "test-secret-with-length",
    });

    expect(config.oidc.enabled).toBe(false);
    expect(config.oidc.testingProfile.email).toBe("dev-user@example.test");
    expect(config.allowedEmails.has("other@example.test")).toBe(true);
  });

  it("requires OIDC runtime values when real OIDC is enabled", () => {
    expect(() =>
      loadConfig({
        ALLOWED_EMAILS: "dev-user@example.test",
        OIDC_ENABLED: "true",
        SECRET_KEY: "test-secret-with-length",
      }),
    ).toThrow(/OIDC_ISSUER_URL/);
  });
});
