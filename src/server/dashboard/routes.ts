import type express from "express";

import { dashboardResponseSchema } from "../../shared/dashboard.ts";
import { createPool } from "../db/pool.ts";
import { loadDashboard, sampleDashboard } from "./service.ts";

export function registerDashboardRoutes(
  app: express.Express,
  databaseUrl: string | undefined,
): void {
  app.get("/api/dashboard", async (_request, response, next) => {
    try {
      if (!databaseUrl) {
        response.json(sampleDashboard());
        return;
      }

      const pool = createPool(databaseUrl);
      try {
        response.json(dashboardResponseSchema.parse(await loadDashboard(pool)));
      } finally {
        await pool.end();
      }
    } catch (error) {
      next(error);
    }
  });
}
