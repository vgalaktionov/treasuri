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
        response.json(
          settingsResponseSchema.parse({
            ...settings,
            overview: sampleSettings().overview,
          }),
        );
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
            failedJobs: [],
            sections: sampleStatusSections(),
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
        response.json(
          exportsResponseSchema.parse({
            exports: [
              {
                createdAt: "2026-05-28 08:00:00+00",
                errorMessage: null,
                exportType: "budget",
                fileId: 1,
                filename: "treasuri-export.xlsx",
                id: 1,
                sizeBytes: 2048,
                status: "completed",
              },
            ],
          }),
        );
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
  return {
    baselineMonths: 6,
    fixedCostsUpcoming: "620.00",
    llmConfidenceThreshold: "0.70",
    llmEnabled: false,
    overview: {
      accounts: [
        {
          currency: "EUR",
          iban: "NL00FAKE0123456789",
          name: "Sample current account",
          provider: "fake",
          status: "Active",
        },
      ],
      sync: {
        lastSync: "fake completed at 2026-05-28 08:00:00+00",
        lookbackDays: 90,
        schedule: "Manual sync",
      },
      taxonomy: { categoryCount: 4, sampleCategories: ["Housing", "Groceries", "Unknown"] },
    },
    safetyBuffer: "1000.00",
    salaryDay: 24,
    syncLookbackDays: 90,
    targetMonthlySavings: "1000.00",
    variableBaseline3m: "0.00",
    variableBaseline6m: "0.00",
  };
}

function sampleStatusSections() {
  return [
    { rows: [{ label: "Migration version", value: "sample" }], title: "Database" },
    { rows: [{ label: "Last sync", value: "none" }], title: "Sync" },
    {
      rows: [
        { label: "Known transactions", value: "6 total" },
        { label: "Classified transactions", value: "4" },
        { label: "Needs review", value: "2" },
      ],
      title: "Transactions",
    },
    { rows: [{ label: "Last forecast update", value: "sample" }], title: "Forecast" },
    { rows: [{ label: "Failed jobs", value: "0" }], title: "Worker" },
    { rows: [{ label: "Latest export", value: "completed" }], title: "Exports" },
    {
      rows: [
        { label: "Secrets", value: "redacted" },
        { label: "OIDC", value: "disabled" },
        { label: "Bank provider", value: "fake" },
      ],
      title: "Runtime",
    },
  ];
}
