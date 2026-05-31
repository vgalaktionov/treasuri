import type express from "express";

import {
  categoryBudgetResponseSchema,
  recurringActionResponseSchema,
  recurringResponseSchema,
  ruleActiveUpdateRequestSchema,
  ruleApplyResponseSchema,
  ruleCreateResponseSchema,
  ruleEditorRequestSchema,
  rulePreviewRequestSchema,
  rulePreviewResponseSchema,
  rulesResponseSchema,
  transactionFiltersSchema,
  transactionRawDetailsSchema,
  transactionsResponseSchema,
  transactionUpdateRequestSchema,
} from "../../shared/management.ts";
import { createPool } from "../db/pool.ts";
import { listCategories, listCategoryBudgets } from "./categories.ts";
import { confirmRecurring, disableRecurring, listRecurring } from "./recurring.ts";
import {
  applyRule,
  createRule,
  listRules,
  previewRule,
  setRuleActive,
  updateRule,
} from "./rules.ts";
import {
  sampleCategories,
  sampleCategoryBudgets,
  sampleRawDetails,
  sampleRecurringFor,
  sampleRuleFromInput,
  sampleRulesFor,
  sampleTransactions,
} from "./sample.ts";
import { getTransactionRawDetails, listTransactions, updateTransaction } from "./transactions.ts";

export function registerManagementRoutes(
  app: express.Express,
  databaseUrl: string | undefined,
): void {
  const sampleRuleStores = new Map<string, ReturnType<typeof sampleRulesFor>>();
  const sampleRecurringStores = new Map<string, ReturnType<typeof sampleRecurringFor>>();

  app.get("/api/transactions", async (request, response, next) => {
    try {
      if (!databaseUrl) {
        response.json(
          transactionsResponseSchema.parse(sampleTransactions(filtersFromQuery(request.query))),
        );
        return;
      }
      const pool = createPool(databaseUrl);
      try {
        response.json(
          transactionsResponseSchema.parse(
            await listTransactions(pool, filtersFromQuery(request.query)),
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
      const body = transactionUpdateRequestSchema.parse(request.body);
      if (!databaseUrl) {
        response.json({ ok: true });
        return;
      }
      const pool = createPool(databaseUrl);
      try {
        await updateTransaction(pool, Number(request.params.id), body);
        response.json({ ok: true });
      } finally {
        await pool.end();
      }
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/transactions/:id/raw", async (request, response, next) => {
    try {
      if (!databaseUrl) {
        response.json(
          transactionRawDetailsSchema.parse(sampleRawDetails(Number(request.params.id))),
        );
        return;
      }
      const pool = createPool(databaseUrl);
      try {
        response.json(
          transactionRawDetailsSchema.parse(
            await getTransactionRawDetails(pool, Number(request.params.id)),
          ),
        );
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

  app.get("/api/category-budgets", async (_request, response, next) => {
    try {
      if (!databaseUrl) {
        response.json(categoryBudgetResponseSchema.parse(sampleCategoryBudgets()));
        return;
      }
      const pool = createPool(databaseUrl);
      try {
        response.json(categoryBudgetResponseSchema.parse(await listCategoryBudgets(pool)));
      } finally {
        await pool.end();
      }
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/rules", async (request, response, next) => {
    try {
      if (!databaseUrl) {
        response.json(rulesResponseSchema.parse(sampleRulesFor(sampleRuleStores, request)));
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
            matches: sampleTransactions({ query: rule.pattern }).transactions,
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
      const rule = ruleEditorRequestSchema.parse(request.body);
      if (!databaseUrl) {
        const rules = sampleRulesFor(sampleRuleStores, request);
        const ruleId = Math.max(0, ...rules.rules.map((item) => item.id)) + 1;
        rules.rules.unshift(sampleRuleFromInput(ruleId, rule));
        sampleRuleStores.set(request.sessionID, rules);
        response.json(ruleCreateResponseSchema.parse({ ruleId }));
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

  app.put("/api/rules/:id", async (request, response, next) => {
    try {
      const rule = ruleEditorRequestSchema.parse(request.body);
      if (!databaseUrl) {
        const rules = sampleRulesFor(sampleRuleStores, request);
        rules.rules = rules.rules.map((item) =>
          item.id === Number(request.params.id)
            ? sampleRuleFromInput(Number(request.params.id), rule)
            : item,
        );
        sampleRuleStores.set(request.sessionID, rules);
        response.json({ ok: true });
        return;
      }
      const pool = createPool(databaseUrl);
      try {
        await updateRule(pool, Number(request.params.id), rule);
        response.json({ ok: true });
      } finally {
        await pool.end();
      }
    } catch (error) {
      next(error);
    }
  });

  app.patch("/api/rules/:id/active", async (request, response, next) => {
    try {
      const body = ruleActiveUpdateRequestSchema.parse(request.body);
      if (!databaseUrl) {
        const rules = sampleRulesFor(sampleRuleStores, request);
        rules.rules = rules.rules.map((item) =>
          item.id === Number(request.params.id) ? { ...item, isActive: body.isActive } : item,
        );
        sampleRuleStores.set(request.sessionID, rules);
        response.json({ ok: true });
        return;
      }
      const pool = createPool(databaseUrl);
      try {
        await setRuleActive(pool, Number(request.params.id), body.isActive);
        response.json({ ok: true });
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

  app.get("/api/recurring", async (request, response, next) => {
    try {
      if (!databaseUrl) {
        response.json(
          recurringResponseSchema.parse(sampleRecurringFor(sampleRecurringStores, request)),
        );
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

  app.post("/api/recurring/:id/confirm", async (request, response, next) => {
    try {
      if (!databaseUrl) {
        const recurring = sampleRecurringFor(sampleRecurringStores, request);
        recurring.series = recurring.series.map((series) =>
          series.id === Number(request.params.id)
            ? { ...series, confidence: "0.90", isConfirmed: true, warnings: [] }
            : series,
        );
        sampleRecurringStores.set(request.sessionID, recurring);
        response.json(recurringActionResponseSchema.parse({ ok: true }));
        return;
      }
      const pool = createPool(databaseUrl);
      try {
        response.json(
          recurringActionResponseSchema.parse({
            ok: await confirmRecurring(pool, Number(request.params.id)),
          }),
        );
      } finally {
        await pool.end();
      }
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/recurring/:id/disable", async (request, response, next) => {
    try {
      if (!databaseUrl) {
        const recurring = sampleRecurringFor(sampleRecurringStores, request);
        recurring.series = recurring.series.filter(
          (series) => series.id !== Number(request.params.id),
        );
        sampleRecurringStores.set(request.sessionID, recurring);
        response.json(recurringActionResponseSchema.parse({ ok: true }));
        return;
      }
      const pool = createPool(databaseUrl);
      try {
        response.json(
          recurringActionResponseSchema.parse({
            ok: await disableRecurring(pool, Number(request.params.id)),
          }),
        );
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
    return { categories: await listCategories(pool) };
  } finally {
    await pool.end();
  }
}

function filtersFromQuery(query: express.Request["query"]) {
  return transactionFiltersSchema.parse({
    category: stringQuery(query.category),
    kind: stringQuery(query.kind),
    maxAmount: stringQuery(query.maxAmount),
    merchant: stringQuery(query.merchant),
    minAmount: stringQuery(query.minAmount),
    month: stringQuery(query.month),
    needsReview: query.needsReview === "true" ? true : undefined,
    query: stringQuery(query.query),
  });
}

function stringQuery(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    return stringQuery(value[0]);
  }
  if (typeof value !== "string" || value === "") {
    return undefined;
  }
  return value;
}
