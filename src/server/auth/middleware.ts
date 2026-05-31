import type { NextFunction, Request, Response } from "express";

import type { AppConfig, TestingProfile } from "../config/env.ts";
import { isAllowedEmail } from "../config/env.ts";
import type { AuthUser } from "./types.ts";

export function requireAuth(config: AppConfig) {
  return (request: Request, response: Response, next: NextFunction) => {
    const user = resolveUser(config, request);

    if (!user) {
      if (config.oidc.enabled && !request.path.startsWith("/api/")) {
        response.redirect(`/auth/login?returnTo=${encodeURIComponent(request.originalUrl || "/")}`);
        return;
      }
      response.status(401).json({ error: "Authentication required" });
      return;
    }

    if (!isAllowedEmail(config, user.email)) {
      response.status(403).json({ error: "User is not allowed" });
      return;
    }

    request.session.authUser = user;
    request.authUser = user;
    next();
  };
}

function resolveUser(config: AppConfig, request: Request): AuthUser | null {
  if (request.session.authUser) {
    return request.session.authUser;
  }

  if (!config.oidc.enabled) {
    return authUserFromTestingProfile(config.oidc.testingProfile);
  }

  return null;
}

function authUserFromTestingProfile(profile: TestingProfile): AuthUser {
  return {
    email: profile.email,
    groups: profile.groups,
    name: profile.nickname ?? profile.email,
    sub: profile.sub,
  };
}
