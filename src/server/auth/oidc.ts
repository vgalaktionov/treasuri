import * as oidc from "openid-client";

import type { AppConfig } from "../config/env.ts";

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
