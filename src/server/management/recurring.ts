import type pg from "pg";

type RecurringCandidate = {
  categoryId: number | null;
  expectedAmount: string;
  expectedDayOfMonth: number;
  lastSeenDate: string;
  merchantId: number | null;
  name: string;
  transactionIds: number[];
};

export async function listRecurring(pool: pg.Pool) {
  const result = await pool.query<{
    amount_tolerance: string | null;
    cadence: string;
    category_name: string | null;
    confidence: string;
    expected_amount: string | null;
    expected_day_of_month: number | null;
    id: string;
    is_confirmed: boolean;
    last_booking_date: string | null;
    max_amount: string | null;
    min_amount: string | null;
    name: string;
    next_expected_date: string | null;
  }>(`
    SELECT
      recurring_series.id,
      recurring_series.name,
      recurring_series.cadence,
      recurring_series.expected_amount::text,
      recurring_series.next_expected_date::text,
      recurring_series.confidence::text,
      recurring_series.is_confirmed,
      recurring_series.amount_tolerance::text,
      recurring_series.expected_day_of_month,
      categories.name AS category_name,
      activity.min_amount::text,
      activity.max_amount::text,
      activity.last_booking_date::text
    FROM recurring_series
    LEFT JOIN categories ON categories.id = recurring_series.category_id
    LEFT JOIN LATERAL (
      SELECT
        min(abs(raw_transactions.amount)) AS min_amount,
        max(abs(raw_transactions.amount)) AS max_amount,
        max(raw_transactions.booking_date) AS last_booking_date
      FROM enriched_transactions
      JOIN raw_transactions ON raw_transactions.id = enriched_transactions.raw_transaction_id
      WHERE enriched_transactions.recurring_series_id = recurring_series.id
    ) AS activity ON true
    WHERE recurring_series.is_active = true
    ORDER BY recurring_series.next_expected_date NULLS LAST, recurring_series.name
  `);
  return {
    series: result.rows.map((row) => ({
      amount: row.expected_amount,
      amountTolerance: row.amount_tolerance,
      categoryName: row.category_name,
      cadence: row.cadence,
      confidence: Number(row.confidence).toFixed(2),
      expectedDayOfMonth: row.expected_day_of_month,
      id: Number(row.id),
      isConfirmed: row.is_confirmed,
      lastBookingDate: row.last_booking_date,
      maxAmount: row.max_amount,
      minAmount: row.min_amount,
      name: row.name,
      nextExpectedDate: row.next_expected_date,
      warnings: recurringWarnings(row),
    })),
  };
}

export async function detectRecurringCandidates(pool: pg.Pool) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const candidates = await findMonthlyCandidates(client);
    let linkedTransactionCount = 0;

    for (const candidate of candidates) {
      const seriesId = await upsertRecurringSeries(client, candidate);
      linkedTransactionCount += await linkRecurringTransactions(client, seriesId, candidate);
    }

    await client.query("COMMIT");
    return { detectedCount: candidates.length, linkedTransactionCount };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function confirmRecurring(pool: pg.Pool, seriesId: number): Promise<boolean> {
  const result = await pool.query(
    `
      UPDATE recurring_series
      SET is_confirmed = true, confidence = greatest(confidence, 0.90), updated_at = now()
      WHERE id = $1 AND is_active = true
    `,
    [seriesId],
  );
  return result.rowCount === 1;
}

export async function disableRecurring(pool: pg.Pool, seriesId: number): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `
        UPDATE recurring_series
        SET is_active = false, is_confirmed = false, updated_at = now()
        WHERE id = $1 AND is_active = true
      `,
      [seriesId],
    );
    if (result.rowCount === 1) {
      await client.query(
        `
          UPDATE enriched_transactions
          SET is_recurring = false, recurring_series_id = NULL, updated_at = now()
          WHERE recurring_series_id = $1
        `,
        [seriesId],
      );
    }
    await client.query("COMMIT");
    return result.rowCount === 1;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function findMonthlyCandidates(client: pg.PoolClient): Promise<RecurringCandidate[]> {
  const result = await client.query<{
    category_id: string | null;
    expected_amount: string;
    expected_day_of_month: number;
    last_seen_date: string;
    merchant_id: string | null;
    name: string;
    transaction_ids: number[];
  }>(`
    SELECT
      enriched_transactions.merchant_id::text,
      enriched_transactions.category_id::text,
      COALESCE(merchants.name, raw_transactions.counterparty_name, 'Recurring candidate') AS name,
      round(avg(abs(raw_transactions.amount)), 2)::text AS expected_amount,
      round(avg(extract(day from raw_transactions.booking_date)))::int AS expected_day_of_month,
      max(raw_transactions.booking_date)::text AS last_seen_date,
      array_agg(enriched_transactions.id ORDER BY raw_transactions.booking_date) AS transaction_ids,
      count(DISTINCT to_char(raw_transactions.booking_date, 'YYYY-MM')) AS month_count
    FROM enriched_transactions
    JOIN raw_transactions ON raw_transactions.id = enriched_transactions.raw_transaction_id
    LEFT JOIN merchants ON merchants.id = enriched_transactions.merchant_id
    WHERE raw_transactions.amount < 0
      AND enriched_transactions.is_income = false
      AND enriched_transactions.is_transfer = false
      AND enriched_transactions.is_excluded_from_budget = false
      AND COALESCE(merchants.name, raw_transactions.counterparty_name) IS NOT NULL
    GROUP BY
      enriched_transactions.merchant_id,
      enriched_transactions.category_id,
      COALESCE(merchants.name, raw_transactions.counterparty_name, 'Recurring candidate')
    HAVING count(DISTINCT to_char(raw_transactions.booking_date, 'YYYY-MM')) >= 2
  `);

  return result.rows.map((row) => ({
    categoryId: row.category_id ? Number(row.category_id) : null,
    expectedAmount: row.expected_amount,
    expectedDayOfMonth: row.expected_day_of_month,
    lastSeenDate: row.last_seen_date,
    merchantId: row.merchant_id ? Number(row.merchant_id) : null,
    name: row.name,
    transactionIds: row.transaction_ids.map(Number),
  }));
}

async function upsertRecurringSeries(
  client: pg.PoolClient,
  candidate: RecurringCandidate,
): Promise<number> {
  const nextExpectedDate = nextMonthDate(candidate.lastSeenDate, candidate.expectedDayOfMonth);
  const existing = await client.query<{ id: string }>(
    `
      SELECT id::text
      FROM recurring_series
      WHERE name = $1 AND cadence = 'monthly' AND is_active = true
      LIMIT 1
    `,
    [candidate.name],
  );

  if (existing.rows[0]) {
    await client.query(
      `
        UPDATE recurring_series
        SET merchant_id = $2,
          category_id = $3,
          expected_amount = $4,
          amount_tolerance = COALESCE(amount_tolerance, 2.00),
          expected_day_of_month = $5,
          next_expected_date = $6,
          confidence = greatest(confidence, 0.80),
          updated_at = now()
        WHERE id = $1
      `,
      [
        existing.rows[0].id,
        candidate.merchantId,
        candidate.categoryId,
        candidate.expectedAmount,
        candidate.expectedDayOfMonth,
        nextExpectedDate,
      ],
    );
    return Number(existing.rows[0].id);
  }

  const inserted = await client.query<{ id: string }>(
    `
      INSERT INTO recurring_series (
        merchant_id, category_id, name, cadence, amount_mode, expected_amount,
        amount_tolerance, expected_day_of_month, next_expected_date, confidence, is_confirmed
      )
      VALUES ($1, $2, $3, 'monthly', 'fixed', $4, 2.00, $5, $6, 0.80, false)
      RETURNING id::text
    `,
    [
      candidate.merchantId,
      candidate.categoryId,
      candidate.name,
      candidate.expectedAmount,
      candidate.expectedDayOfMonth,
      nextExpectedDate,
    ],
  );
  const row = inserted.rows[0];
  if (!row) {
    throw new Error("Recurring series insert did not return an id");
  }
  return Number(row.id);
}

async function linkRecurringTransactions(
  client: pg.PoolClient,
  seriesId: number,
  candidate: RecurringCandidate,
): Promise<number> {
  const result = await client.query(
    `
      UPDATE enriched_transactions
      SET recurring_series_id = $1,
        is_recurring = true,
        is_fixed_cost = true,
        is_variable_cost = false,
        updated_at = now()
      WHERE id = ANY($2::bigint[])
    `,
    [seriesId, candidate.transactionIds],
  );
  return result.rowCount ?? 0;
}

function nextMonthDate(lastSeenDate: string, expectedDayOfMonth: number): string {
  const lastSeen = new Date(`${lastSeenDate}T00:00:00.000Z`);
  const nextMonth = new Date(Date.UTC(lastSeen.getUTCFullYear(), lastSeen.getUTCMonth() + 1, 1));
  const cappedDay = Math.min(expectedDayOfMonth, 28);
  nextMonth.setUTCDate(cappedDay);
  return nextMonth.toISOString().slice(0, 10);
}

function recurringWarnings(row: {
  amount_tolerance: string | null;
  expected_day_of_month: number | null;
  is_confirmed: boolean;
  last_booking_date: string | null;
  max_amount: string | null;
  min_amount: string | null;
  next_expected_date: string | null;
}): string[] {
  const warnings: string[] = [];
  if (!row.is_confirmed) {
    warnings.push("New recurring payment detected");
  }
  if (
    row.amount_tolerance &&
    row.min_amount &&
    row.max_amount &&
    Number(row.max_amount) - Number(row.min_amount) > Number(row.amount_tolerance)
  ) {
    warnings.push("Amount changed");
  }
  if (row.next_expected_date && row.next_expected_date < new Date().toISOString().slice(0, 10)) {
    warnings.push("Expected payment missing");
  }
  if (row.expected_day_of_month && row.last_booking_date) {
    const day = Number(row.last_booking_date.slice(8, 10));
    const delta = day - row.expected_day_of_month;
    if (delta <= -3) {
      warnings.push("Payment arrived earlier than usual");
    } else if (delta >= 3) {
      warnings.push("Payment arrived later than usual");
    }
  }
  return warnings;
}
