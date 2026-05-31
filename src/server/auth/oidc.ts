import type express from "express";
import * as oidc from "openid-client";

import type { AppConfig } from "../config/env.ts";
import { isAllowedEmail } from "../config/env.ts";
import { requireCsrf } from "./csrf.ts";
import type { AuthUser } from "./types.ts";

export async function discoverOidc(config: AppConfig) {
  if (!config.oidc.enabled) {
    return null;
  }

  const { clientId, clientSecret, issuerUrl } = config.oidc;

  if (!issuerUrl || !clientId || !clientSecret) {
    throw new Error("OIDC configuration is incomplete");
  }

  return oidc.discovery(new URL(issuerUrl), clientId, clientSecret);
}

export function registerOidcRoutes(app: express.Express, config: AppConfig): void {
  const configuration = lazyConfiguration(config);

  app.get("/auth/login", async (request, response, next) => {
    try {
      if (!config.oidc.enabled) {
        response.redirect(safeReturnTo(request.query.returnTo));
        return;
      }

      const clientConfig = await requiredConfiguration(configuration);
      const codeVerifier = oidc.randomPKCECodeVerifier();
      const state = oidc.randomState();
      request.session.oidcCodeVerifier = codeVerifier;
      request.session.oidcState = state;
      request.session.oidcReturnTo = safeReturnTo(request.query.returnTo);

      const redirectTo = oidc.buildAuthorizationUrl(clientConfig, {
        code_challenge: await oidc.calculatePKCECodeChallenge(codeVerifier),
        code_challenge_method: "S256",
        redirect_uri: requiredOidc(config.oidc.redirectUri, "OIDC_REDIRECT_URI"),
        scope: config.oidc.scopes,
        state,
      });

      response.redirect(redirectTo.href);
    } catch (error) {
      next(error);
    }
  });

  app.get("/auth/callback", async (request, response, next) => {
    try {
      if (!config.oidc.enabled) {
        response.redirect("/");
        return;
      }

      const codeVerifier = request.session.oidcCodeVerifier;
      const expectedState = request.session.oidcState;
      if (!codeVerifier || !expectedState) {
        response.status(400).json({ error: "Missing OIDC login state" });
        return;
      }

      const clientConfig = await requiredConfiguration(configuration);
      const tokens = await oidc.authorizationCodeGrant(clientConfig, currentUrl(request), {
        expectedState,
        pkceCodeVerifier: codeVerifier,
      });
      const claims = tokens.claims();
      const user = await authUserFromTokens(clientConfig, tokens, claims);
      if (!isAllowedEmail(config, user.email)) {
        response.status(403).json({ error: "User is not allowed" });
        return;
      }

      request.session.authUser = user;
      delete request.session.oidcCodeVerifier;
      delete request.session.oidcState;
      const returnTo = request.session.oidcReturnTo ?? "/";
      delete request.session.oidcReturnTo;
      response.redirect(returnTo);
    } catch (error) {
      next(error);
    }
  });

  app.post("/logout", requireCsrf, (request, response) => {
    request.session.destroy(() => {
      response.status(204).end();
    });
  });
}

function lazyConfiguration(config: AppConfig) {
  let promise: Promise<oidc.Configuration> | null = null;
  return () => {
    promise ??= requiredDiscoveredConfiguration(config);
    return promise;
  };
}

async function requiredConfiguration(
  configuration: () => Promise<oidc.Configuration>,
): Promise<oidc.Configuration> {
  return configuration();
}

async function requiredDiscoveredConfiguration(config: AppConfig): Promise<oidc.Configuration> {
  const discovered = await discoverOidc(config);
  if (!discovered) {
    throw new Error("OIDC is disabled");
  }
  return discovered;
}

async function authUserFromTokens(
  config: oidc.Configuration,
  tokens: oidc.TokenEndpointResponse & { claims: () => oidc.IDToken | undefined },
  claims: oidc.IDToken | undefined,
): Promise<AuthUser> {
  const accessToken = stringClaim(tokens.access_token);
  const subject = stringClaim(claims?.sub);
  const userInfo =
    accessToken && subject
      ? await oidc.fetchUserInfo(config, accessToken, subject).catch(() => undefined)
      : undefined;
  const email = stringClaim(claims?.email) ?? stringClaim(userInfo?.email);
  const sub = subject ?? stringClaim(userInfo?.sub);

  if (!email || !sub) {
    throw new Error("OIDC profile is missing required email or subject");
  }

  return {
    email,
    groups: stringArrayClaim(claims?.groups) ?? stringArrayClaim(userInfo?.groups) ?? [],
    name:
      stringClaim(claims?.name) ??
      stringClaim(userInfo?.name) ??
      stringClaim(claims?.preferred_username) ??
      email,
    sub,
  };
}

function currentUrl(request: express.Request): URL {
  return new URL(request.originalUrl, `${request.protocol}://${request.get("host")}`);
}

function safeReturnTo(value: unknown): string {
  const returnTo = Array.isArray(value) ? value[0] : value;
  if (typeof returnTo !== "string" || !returnTo.startsWith("/") || returnTo.startsWith("//")) {
    return "/";
  }
  return returnTo;
}

function requiredOidc(value: string | undefined, name: string): string {
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function stringClaim(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function stringArrayClaim(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? value
    : undefined;
}
