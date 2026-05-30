import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";

import { requireAuth } from "../auth/middleware.ts";
import { createSessionMiddleware } from "../auth/session.ts";
import type { AppConfig } from "../config/env.ts";
import { loadConfig } from "../config/env.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const clientDist = path.join(repoRoot, "dist/client");

export function createApp(config: AppConfig = loadConfig()) {
  const app = express();

  app.get("/healthz", (_request, response) => {
    response.json({ status: "ok" });
  });

  app.use(express.static(clientDist, { index: false }));
  app.use(createSessionMiddleware(config));
  app.use(requireAuth(config));

  app.get("/api/me", (request, response) => {
    response.json({ user: request.authUser });
  });

  app.get(/.*/, (_request, response) => {
    response.sendFile(path.join(clientDist, "index.html"));
  });

  return app;
}
