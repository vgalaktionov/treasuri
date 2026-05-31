import type pg from "pg";

import { sql, toQuery } from "../db/sql.ts";
import type { SampleTransaction } from "./data.ts";
import {
  sampleAccountBalance,
  sampleAccountIban,
  sampleTransactions,
  sampleYearMonth,
} from "./data.ts";

export type SampleLoadResult = {
  accountId: number;
  rawTransactionCount: number;
  reviewCount: number;
};

export async function loadSampleData(pool: pg.Pool): Promise<SampleLoadResult> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const accountId = await upsertSampleAccount(client);
    await upsertMerchants(client);

    for (const transaction of sampleTransactions) {
      await upsertSampleTransaction(client, accountId, transaction);
    }

    const syncRunId = await replaceSampleSyncRun(client);
    await upsertBalanceSnapshot(client, accountId, syncRunId);
    await replaceSampleRecurringSeries(client);
    await upsertSampleSettings(client);
    await upsertSampleForecast(client);
    await client.query("COMMIT");

    return {
      accountId,
      rawTransactionCount: sampleTransactions.length,
      reviewCount: sampleTransactions.filter((transaction) => transaction.needsReview).length,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function upsertSampleAccount(client: pg.PoolClient): Promise<number> {
  const result = await client.query<{ id: string }>(
    toQuery(sql`
      INSERT INTO accounts (provider, iban, name, currency)
      VALUES ('fake', ${sampleAccountIban}, 'Sample current account', 'EUR')
      ON CONFLICT (provider, iban)
      DO UPDATE SET name = EXCLUDED.name, updated_at = now()
      RETURNING id
    `),
  );

  return Number(requiredRow(result).id);
}

async function upsertMerchants(client: pg.PoolClient): Promise<void> {
  for (const transaction of sampleTransactions) {
    await client.query(
      toQuery(sql`
        INSERT INTO merchants (name, normalized_name, default_category_id)
        VALUES (
          ${transaction.merchant},
          ${normalizeText(transaction.merchant)},
          (SELECT id FROM categories WHERE name = ${transaction.category})
        )
        ON CONFLICT (normalized_name)
        DO UPDATE SET default_category_id = EXCLUDED.default_category_id, updated_at = now()
      `),
    );
  }
}

async function upsertSampleTransaction(
  client: pg.PoolClient,
  accountId: number,
  transaction: SampleTransaction,
): Promise<void> {
  const rawResult = await client.query<{ id: string }>(
    toQuery(sql`
      INSERT INTO raw_transactions (
        account_id, provider, provider_transaction_id, source_hash, booking_date, value_date,
        amount, currency, counterparty_name, description, raw_payload_json
      )
      VALUES (
        ${accountId}, 'fake', ${transaction.sourceHash}, ${transaction.sourceHash},
        ${transaction.bookingDate}, ${transaction.bookingDate}, ${transaction.amount}, 'EUR',
        ${transaction.counterpartyName}, ${transaction.description}, ${JSON.stringify({ source: "sample" })}::jsonb
      )
      ON CONFLICT (account_id, source_hash)
      DO UPDATE SET
        last_seen_at = now(),
        amount = EXCLUDED.amount,
        counterparty_name = EXCLUDED.counterparty_name,
        description = EXCLUDED.description
      RETURNING id
    `),
  );
  const rawTransactionId = Number(requiredRow(rawResult).id);

  await client.query(
    toQuery(sql`
      INSERT INTO enriched_transactions (
        raw_transaction_id, merchant_id, category_id, is_income, is_transfer, is_savings,
        is_fixed_cost, is_variable_cost, is_one_off, is_excluded_from_budget, needs_review,
        classification_method, classification_confidence, classification_reason
      )
      VALUES (
        ${rawTransactionId},
        (SELECT id FROM merchants WHERE normalized_name = ${normalizeText(transaction.merchant)}),
        (SELECT id FROM categories WHERE name = ${transaction.category}),
        ${transaction.isIncome ?? false}, ${transaction.isTransfer ?? false},
        ${transaction.isSavings ?? false}, ${transaction.isFixedCost ?? false},
        ${transaction.isVariableCost ?? true}, ${transaction.isOneOff ?? false},
        ${transaction.isExcludedFromBudget ?? false}, ${transaction.needsReview ?? false},
        ${transaction.classificationMethod}, ${transaction.classificationConfidence},
        'Loaded from deterministic sample data.'
      )
      ON CONFLICT (raw_transaction_id)
      DO UPDATE SET
        merchant_id = EXCLUDED.merchant_id,
        category_id = EXCLUDED.category_id,
        is_income = EXCLUDED.is_income,
        is_transfer = EXCLUDED.is_transfer,
        is_savings = EXCLUDED.is_savings,
        is_fixed_cost = EXCLUDED.is_fixed_cost,
        is_variable_cost = EXCLUDED.is_variable_cost,
        is_one_off = EXCLUDED.is_one_off,
        is_excluded_from_budget = EXCLUDED.is_excluded_from_budget,
        needs_review = EXCLUDED.needs_review,
        classification_method = EXCLUDED.classification_method,
        classification_confidence = EXCLUDED.classification_confidence,
        updated_at = now()
    `),
  );
}

async function replaceSampleSyncRun(client: pg.PoolClient): Promise<number> {
  await client.query('DELETE FROM sync_runs WHERE metadata_json @> \'{"source":"sample"}\'::jsonb');
  const result = await client.query<{ id: string }>(
    toQuery(sql`
      INSERT INTO sync_runs (
        provider, finished_at, status, new_transaction_count, updated_transaction_count, metadata_json
      )
      VALUES ('fake', '2026-05-28T08:00:00Z', 'completed', ${sampleTransactions.length}, 0, ${JSON.stringify(
        {
          source: "sample",
        },
      )}::jsonb)
      RETURNING id
    `),
  );

  return Number(requiredRow(result).id);
}

async function upsertBalanceSnapshot(
  client: pg.PoolClient,
  accountId: number,
  syncRunId: number,
): Promise<void> {
  await client.query(
    toQuery(sql`
      INSERT INTO account_balance_snapshots (account_id, balance, currency, source, as_of, sync_run_id)
      VALUES (${accountId}, ${sampleAccountBalance}, 'EUR', 'sample', '2026-05-28T08:00:00Z', ${syncRunId})
      ON CONFLICT (account_id, source, as_of)
      DO UPDATE SET balance = EXCLUDED.balance, sync_run_id = EXCLUDED.sync_run_id
    `),
  );
}

async function replaceSampleRecurringSeries(client: pg.PoolClient): Promise<void> {
  await client.query("DELETE FROM recurring_series WHERE name LIKE 'Sample %'");
  await client.query(`
    INSERT INTO recurring_series (
      name, cadence, amount_mode, expected_amount, amount_tolerance, expected_day_of_month,
      next_expected_date, confidence, is_confirmed, is_active, category_id
    )
    VALUES
      (
        'Sample Rent', 'monthly', 'fixed', 1450.00, 0, 1, '2026-06-01', 1, true, true,
        (SELECT id FROM categories WHERE name = 'Rent / Mortgage')
      ),
      (
        'Sample Streaming', 'monthly', 'fixed', 14.99, 0, 15, '2026-06-15', 0.80, false, true,
        (SELECT id FROM categories WHERE name = 'Subscriptions')
      )
  `);
}

async function upsertSampleSettings(client: pg.PoolClient): Promise<void> {
  await upsertSetting(client, "target_monthly_savings", { amount: "1000.00", currency: "EUR" });
  await upsertSetting(client, "safety_buffer", { amount: "1000.00", currency: "EUR" });
  await upsertSetting(client, "baseline_months", { value: 6 });
}

async function upsertSetting(client: pg.PoolClient, key: string, value: unknown): Promise<void> {
  await client.query(
    toQuery(sql`
      INSERT INTO app_settings (key, value_json)
      VALUES (${key}, ${JSON.stringify(value)}::jsonb)
      ON CONFLICT (key) DO UPDATE SET value_json = EXCLUDED.value_json, updated_at = now()
    `),
  );
}

async function upsertSampleForecast(client: pg.PoolClient): Promise<void> {
  await client.query(
    toQuery(sql`
      INSERT INTO monthly_forecasts (
        year_month, income_received, fixed_costs_paid, fixed_costs_upcoming, variable_spent,
        predicted_variable_remaining, target_savings, safety_buffer, safe_to_spend,
        safe_per_day, projected_savings, confidence, explanation_json
      )
      VALUES (
        ${sampleYearMonth}, 5258.00, 1450.00, 620.00, 696.40, 760.00, 1000.00,
        1000.00, 558.00, 93.00, 1087.00, 'medium',
        ${JSON.stringify({ source: "sample", review_count: 1 })}::jsonb
      )
      ON CONFLICT (year_month)
      DO UPDATE SET
        safe_to_spend = EXCLUDED.safe_to_spend,
        safe_per_day = EXCLUDED.safe_per_day,
        projected_savings = EXCLUDED.projected_savings,
        explanation_json = EXCLUDED.explanation_json,
        updated_at = now()
    `),
  );
}

function normalizeText(value: string): string {
  return value.toLowerCase();
}

function requiredRow<T extends pg.QueryResultRow>(result: pg.QueryResult<T>): T {
  const row = result.rows[0];
  if (!row) {
    throw new Error("Expected database row");
  }
  return row;
}
