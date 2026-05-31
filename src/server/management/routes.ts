import type express from "express";

import {
  recurringResponseSchema,
  ruleApplyResponseSchema,
  ruleCreateResponseSchema,
  rulePreviewRequestSchema,
  rulePreviewResponseSchema,
  rulesResponseSchema,
  type TransactionsResponse,
  transactionFiltersSchema,
  transactionRawDetailsSchema,
  transactionsResponseSchema,
  transactionUpdateRequestSchema,
} from "../../shared/management.ts";
import { createPool } from "../db/pool.ts";
import { applyRule, createRule, listRecurring, listRules, previewRule } from "./service.ts";
import { getTransactionRawDetails, listTransactions, updateTransaction } from "./transactions.ts";

export function registerManagementRoutes(
  app: express.Express,
  databaseUrl: string | undefined,
): void {
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
  { id: 4, name: "Savings" },
];

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

function sampleTransactions(filters: ReturnType<typeof filtersFromQuery>): TransactionsResponse {
  const needle = (filters.query ?? "").toLowerCase();
  const transactions = [
    {
      amount: "-89.95",
      bookingDate: "2026-05-20",
      categoryId: 1,
      categoryName: "Dog",
      classificationMethod: "sample",
      description: "Dog food sample",
      flags: [],
      id: 1,
      merchant: "Sample Pet Care",
      needsReview: false,
    },
    {
      amount: "-64.35",
      bookingDate: "2026-05-26",
      categoryId: 2,
      categoryName: "Groceries",
      classificationMethod: "sample",
      description: "Groceries sample",
      flags: [],
      id: 2,
      merchant: "Sample Supermarket",
      needsReview: false,
    },
    {
      amount: "-500.00",
      bookingDate: "2026-05-16",
      categoryId: 3,
      categoryName: "Unknown",
      classificationMethod: "sample",
      description: "Savings transfer sample",
      flags: ["transfer", "savings"],
      id: 3,
      merchant: "Sample Own Savings",
      needsReview: false,
    },
    {
      amount: "-42.10",
      bookingDate: "2026-05-27",
      categoryId: 3,
      categoryName: "Unknown",
      classificationMethod: "uncategorized",
      description: "Needs review sample",
      flags: [],
      id: 4,
      merchant: "Unknown Sample Merchant",
      needsReview: true,
    },
  ].filter((transaction) => {
    const matchesSearch = needle
      ? `${transaction.description} ${transaction.merchant}`.toLowerCase().includes(needle)
      : true;
    const matchesCategory = filters.category ? transaction.categoryName === filters.category : true;
    const matchesMerchant = filters.merchant ? transaction.merchant === filters.merchant : true;
    const matchesReview = filters.needsReview ? transaction.needsReview : true;
    const matchesKind = filters.kind ? transaction.flags.includes(filters.kind) : true;
    return matchesSearch && matchesCategory && matchesMerchant && matchesReview && matchesKind;
  });
  return {
    categories: sampleCategories,
    merchants: [...new Set(transactions.map((transaction) => transaction.merchant))],
    transactions,
  };
}

function sampleRawDetails(id: number) {
  const transaction = sampleTransactions({}).transactions.find((item) => item.id === id);
  if (!transaction) {
    throw new Error("Transaction not found");
  }
  return {
    amount: transaction.amount,
    bookingDate: transaction.bookingDate,
    categoryName: transaction.categoryName,
    description: transaction.description,
    details: [
      { label: "Account", value: "Sample current account" },
      { label: "IBAN", value: "NL00FAKE0123456789" },
      { label: "Provider", value: "fake" },
      { label: "Currency", value: "EUR" },
    ],
    id: transaction.id,
    merchant: transaction.merchant,
    payloadJson: JSON.stringify({ source: "sample" }, null, 2),
  };
}
