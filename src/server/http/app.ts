import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";

import { ensureCsrfToken, requireCsrf } from "../auth/csrf.ts";
import { requireAuth } from "../auth/middleware.ts";
import { registerOidcRoutes } from "../auth/oidc.ts";
import { createSessionMiddleware } from "../auth/session.ts";
import type { AppConfig } from "../config/env.ts";
import { loadConfig } from "../config/env.ts";
import { registerDashboardRoutes } from "../dashboard/routes.ts";
import { registerManagementRoutes } from "../management/routes.ts";
import { registerOperationsRoutes } from "../operations/routes.ts";
import { registerReviewRoutes } from "../review/routes.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const clientDist = path.join(repoRoot, "dist/client");

export function createApp(config: AppConfig = loadConfig()) {
  const app = express();
  app.use(express.json());

  app.get("/healthz", (_request, response) => {
    response.json({ status: "ok" });
  });

  app.use(express.static(clientDist, { index: false }));
  app.use(createSessionMiddleware(config));
  registerOidcRoutes(app, config);
  app.use(requireAuth(config));

  app.get("/api/me", (request, response) => {
    response.json({ csrfToken: ensureCsrfToken(request), user: request.authUser });
  });

  app.use(requireCsrf);

  registerDashboardRoutes(app, process.env.DATABASE_URL);
  registerManagementRoutes(app, process.env.DATABASE_URL);
  registerOperationsRoutes(app, process.env.DATABASE_URL);
  registerReviewRoutes(app, process.env.DATABASE_URL);

  app.get(/.*/, (_request, response) => {
    response.sendFile(path.join(clientDist, "index.html"));
  });

  return app;
}
