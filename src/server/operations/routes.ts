import type express from "express";

import {
  exportCreateResponseSchema,
  exportsResponseSchema,
  settingsResponseSchema,
  settingsUpdateSchema,
  statusResponseSchema,
} from "../../shared/operations.ts";
import { createPool } from "../db/pool.ts";
import { createXlsxExport, getExportFile, listExports } from "./exportService.ts";
import { loadSettings, loadStatus, saveSettings } from "./service.ts";

export function registerOperationsRoutes(
  app: express.Express,
  databaseUrl: string | undefined,
): void {
  app.get("/api/settings", async (_request, response, next) => {
    try {
      if (!databaseUrl) {
        response.json(settingsResponseSchema.parse(sampleSettings()));
        return;
      }
      const pool = createPool(databaseUrl);
      try {
        response.json(settingsResponseSchema.parse(await loadSettings(pool)));
      } finally {
        await pool.end();
      }
    } catch (error) {
      next(error);
    }
  });

  app.put("/api/settings", async (request, response, next) => {
    try {
      const settings = settingsUpdateSchema.parse(request.body);
      if (!databaseUrl) {
        response.json(settings);
        return;
      }
      const pool = createPool(databaseUrl);
      try {
        await saveSettings(pool, settings);
        response.json(settingsResponseSchema.parse(await loadSettings(pool)));
      } finally {
        await pool.end();
      }
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/status", async (_request, response, next) => {
    try {
      if (!databaseUrl) {
        response.json(
          statusResponseSchema.parse({
            database: "sample",
            failedJobs: [],
            latestSync: null,
            secrets: "redacted",
          }),
        );
        return;
      }
      const pool = createPool(databaseUrl);
      try {
        response.json(statusResponseSchema.parse(await loadStatus(pool)));
      } finally {
        await pool.end();
      }
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/exports", async (_request, response, next) => {
    try {
      if (!databaseUrl) {
        response.json(exportsResponseSchema.parse({ exports: [] }));
        return;
      }
      const pool = createPool(databaseUrl);
      try {
        response.json(exportsResponseSchema.parse(await listExports(pool)));
      } finally {
        await pool.end();
      }
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/exports", async (_request, response, next) => {
    try {
      if (!databaseUrl) {
        response.json(exportCreateResponseSchema.parse({ exportRunId: 1, fileId: 1 }));
        return;
      }
      const pool = createPool(databaseUrl);
      try {
        response.json(exportCreateResponseSchema.parse(await createXlsxExport(pool, "dev-user")));
      } finally {
        await pool.end();
      }
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/exports/:fileId/download", async (request, response, next) => {
    try {
      if (!databaseUrl) {
        response.status(404).json({ error: "Export not found" });
        return;
      }
      const pool = createPool(databaseUrl);
      try {
        const file = await getExportFile(pool, Number(request.params.fileId));
        if (!file) {
          response.status(404).json({ error: "Export not found" });
          return;
        }
        response.type(file.content_type);
        response.attachment(file.filename);
        response.send(file.content);
      } finally {
        await pool.end();
      }
    } catch (error) {
      next(error);
    }
  });
}

function sampleSettings() {
  return { baselineMonths: 6, safetyBuffer: "1000.00", targetMonthlySavings: "1000.00" };
}
