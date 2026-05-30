import session from "express-session";

import type { AppConfig } from "../config/env.ts";

export function createSessionMiddleware(config: AppConfig) {
  return session({
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: config.appEnv === "production",
    },
    name: "treasuri.sid",
    resave: false,
    saveUninitialized: false,
    secret: config.secretKey,
  });
}
