import type express from "express";

import {
  type ReviewActionRequest,
  type ReviewInboxResponse,
  reviewActionRequestSchema,
  reviewInboxResponseSchema,
} from "../../shared/review.ts";
import { createPool } from "../db/pool.ts";
import { applyReviewAction, listReviewInbox } from "./service.ts";

export function registerReviewRoutes(app: express.Express, databaseUrl: string | undefined): void {
  const sampleInboxes = new Map<string, ReviewInboxResponse>();

  app.get("/api/review", async (request, response, next) => {
    try {
      if (!databaseUrl) {
        response.json(reviewInboxResponseSchema.parse(sampleInboxFor(sampleInboxes, request)));
        return;
      }
      const pool = createPool(databaseUrl);
      try {
        response.json(reviewInboxResponseSchema.parse(await listReviewInbox(pool)));
      } finally {
        await pool.end();
      }
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/review/:id/action", async (request, response, next) => {
    try {
      const transactionId = Number(request.params.id);
      const action = reviewActionRequestSchema.parse(request.body);

      if (!databaseUrl) {
        const sampleInbox = applySampleAction(
          sampleInboxFor(sampleInboxes, request),
          transactionId,
          action,
        );
        sampleInboxes.set(request.sessionID, sampleInbox);
        response.json({ reviewCount: sampleInbox.reviewCount, transactionId });
        return;
      }

      const pool = createPool(databaseUrl);
      try {
        response.json(await applyReviewAction(pool, transactionId, action));
      } finally {
        await pool.end();
      }
    } catch (error) {
      next(error);
    }
  });
}

function sampleInboxFor(
  sampleInboxes: Map<string, ReviewInboxResponse>,
  request: express.Request,
): ReviewInboxResponse {
  const existing = sampleInboxes.get(request.sessionID);
  if (existing) {
    return existing;
  }
  const created = createSampleInbox();
  sampleInboxes.set(request.sessionID, created);
  return created;
}

function createSampleInbox(): ReviewInboxResponse {
  return {
    categories: [
      { id: 1, name: "Groceries" },
      { id: 2, name: "Dog" },
      { id: 3, name: "Unknown" },
    ],
    reviewCount: 1,
    transactions: [
      {
        amount: "-42.10",
        bookingDate: "2026-05-27",
        categoryId: 3,
        categoryName: "Unknown",
        counterpartyName: "Unknown Sample Merchant",
        currency: "EUR",
        description: "Needs review sample",
        id: 1,
      },
    ],
  };
}

function applySampleAction(
  inbox: ReviewInboxResponse,
  transactionId: number,
  _action: ReviewActionRequest,
): ReviewInboxResponse {
  const transactions = inbox.transactions.filter((transaction) => transaction.id !== transactionId);
  return { ...inbox, reviewCount: transactions.length, transactions };
}
