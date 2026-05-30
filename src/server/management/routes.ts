import type express from "express";

import {
  categoryUpdateRequestSchema,
  recurringResponseSchema,
  ruleApplyResponseSchema,
  ruleCreateResponseSchema,
  rulePreviewRequestSchema,
  rulePreviewResponseSchema,
  rulesResponseSchema,
  type TransactionsResponse,
  transactionsResponseSchema,
} from "../../shared/management.ts";
import { createPool } from "../db/pool.ts";
import {
  applyRule,
  createRule,
  listRecurring,
  listRules,
  listTransactions,
  previewRule,
  updateTransactionCategory,
} from "./service.ts";

export function registerManagementRoutes(
  app: express.Express,
  databaseUrl: string | undefined,
): void {
  app.get("/api/transactions", async (request, response, next) => {
    try {
      if (!databaseUrl) {
        response.json(transactionsResponseSchema.parse(sampleTransactions(request.query.query)));
        return;
      }
      const pool = createPool(databaseUrl);
      try {
        response.json(
          transactionsResponseSchema.parse(
            await listTransactions(pool, {
              category: String(request.query.category ?? ""),
              query: String(request.query.query ?? ""),
            }),
          ),
        );
      } finally {
        await pool.end();
      }
    } catch (error) {
      next(error);
    }
  });

  app.patch("/api/transactions/:id", async (request, response, next) => {
    try {
      const body = categoryUpdateRequestSchema.parse(request.body);
      if (!databaseUrl) {
        response.json({ ok: true });
        return;
      }
      const pool = createPool(databaseUrl);
      try {
        await updateTransactionCategory(pool, Number(request.params.id), body.categoryId);
        response.json({ ok: true });
      } finally {
        await pool.end();
      }
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/categories", async (_request, response, next) => {
    try {
      response.json((await managementData(databaseUrl)).categories);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/rules", async (_request, response, next) => {
    try {
      if (!databaseUrl) {
        response.json(rulesResponseSchema.parse({ categories: sampleCategories, rules: [] }));
        return;
      }
      const pool = createPool(databaseUrl);
      try {
        response.json(rulesResponseSchema.parse(await listRules(pool)));
      } finally {
        await pool.end();
      }
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/rules/preview", async (request, response, next) => {
    try {
      const rule = rulePreviewRequestSchema.parse(request.body);
      if (!databaseUrl) {
        response.json(
          rulePreviewResponseSchema.parse({
            matches: sampleTransactions(rule.pattern).transactions,
            skippedManualCount: 0,
          }),
        );
        return;
      }
      const pool = createPool(databaseUrl);
      try {
        response.json(rulePreviewResponseSchema.parse(await previewRule(pool, rule)));
      } finally {
        await pool.end();
      }
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/rules", async (request, response, next) => {
    try {
      const rule = rulePreviewRequestSchema.parse(request.body);
      if (!databaseUrl) {
        response.json(ruleCreateResponseSchema.parse({ ruleId: 1 }));
        return;
      }
      const pool = createPool(databaseUrl);
      try {
        response.json(ruleCreateResponseSchema.parse({ ruleId: await createRule(pool, rule) }));
      } finally {
        await pool.end();
      }
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/rules/:id/apply", async (request, response, next) => {
    try {
      if (!databaseUrl) {
        response.json(ruleApplyResponseSchema.parse({ skippedManualCount: 0, updatedCount: 0 }));
        return;
      }
      const pool = createPool(databaseUrl);
      try {
        response.json(
          ruleApplyResponseSchema.parse(await applyRule(pool, Number(request.params.id))),
        );
      } finally {
        await pool.end();
      }
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/recurring", async (_request, response, next) => {
    try {
      if (!databaseUrl) {
        response.json(recurringResponseSchema.parse({ series: [] }));
        return;
      }
      const pool = createPool(databaseUrl);
      try {
        response.json(recurringResponseSchema.parse(await listRecurring(pool)));
      } finally {
        await pool.end();
      }
    } catch (error) {
      next(error);
    }
  });
}

async function managementData(databaseUrl: string | undefined) {
  if (!databaseUrl) {
    return { categories: sampleCategories };
  }
  const pool = createPool(databaseUrl);
  try {
    return { categories: (await listTransactions(pool)).categories };
  } finally {
    await pool.end();
  }
}

const sampleCategories = [
  { id: 1, name: "Dog" },
  { id: 2, name: "Groceries" },
  { id: 3, name: "Unknown" },
];

function sampleTransactions(query: unknown): TransactionsResponse {
  const needle = String(query ?? "").toLowerCase();
  const transactions = [
    {
      amount: "-89.95",
      bookingDate: "2026-05-20",
      categoryId: 1,
      categoryName: "Dog",
      description: "Dog food sample",
      id: 1,
      merchant: "Sample Pet Care",
      needsReview: false,
    },
    {
      amount: "-64.35",
      bookingDate: "2026-05-26",
      categoryId: 2,
      categoryName: "Groceries",
      description: "Groceries sample",
      id: 2,
      merchant: "Sample Supermarket",
      needsReview: false,
    },
  ].filter((transaction) =>
    needle
      ? `${transaction.description} ${transaction.merchant}`.toLowerCase().includes(needle)
      : true,
  );
  return { categories: sampleCategories, transactions };
}
