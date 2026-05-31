import type pg from "pg";

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
