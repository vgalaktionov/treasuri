"""Recurring payment detection and read model."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from decimal import Decimal

import psycopg
from psycopg import Connection


@dataclass(frozen=True)
class RecurringDetectionResult:
    detected_count: int
    linked_transaction_count: int


@dataclass(frozen=True)
class RecurringSeriesItem:
    id: int
    name: str
    category: str
    cadence: str
    expected_amount: str
    next_expected_date: date | None
    confidence: str
    is_confirmed: bool


def confirm_recurring_series(database_url: str, series_id: int) -> bool:
    with psycopg.connect(database_url) as connection:
        with connection.transaction():
            row = connection.execute(
                """
                UPDATE recurring_series
                SET
                    is_confirmed = true,
                    confidence = greatest(confidence, 0.90),
                    updated_at = now()
                WHERE id = %s AND is_active = true
                RETURNING id
                """,
                (series_id,),
            ).fetchone()
    return row is not None


def disable_recurring_series(database_url: str, series_id: int) -> bool:
    with psycopg.connect(database_url) as connection:
        with connection.transaction():
            row = connection.execute(
                """
                UPDATE recurring_series
                SET
                    is_active = false,
                    is_confirmed = false,
                    updated_at = now()
                WHERE id = %s AND is_active = true
                RETURNING id
                """,
                (series_id,),
            ).fetchone()
            if row is not None:
                connection.execute(
                    """
                    UPDATE enriched_transactions
                    SET
                        is_recurring = false,
                        recurring_series_id = NULL,
                        updated_at = now()
                    WHERE recurring_series_id = %s
                    """,
                    (series_id,),
                )
    return row is not None


def detect_recurring(database_url: str) -> RecurringDetectionResult:
    with psycopg.connect(database_url) as connection:
        with connection.transaction():
            candidates = _find_monthly_candidates(connection)
            detected_count = 0
            linked_count = 0
            for candidate in candidates:
                series_id = _upsert_recurring_series(connection, candidate)
                linked_count += _link_transactions(connection, series_id, candidate)
                detected_count += 1
    return RecurringDetectionResult(detected_count=detected_count, linked_transaction_count=linked_count)


def list_recurring_series(database_url: str) -> list[RecurringSeriesItem]:
    with psycopg.connect(database_url) as connection:
        rows = connection.execute(
            """
            SELECT
                recurring_series.id,
                recurring_series.name,
                COALESCE(categories.name, 'Unknown'),
                recurring_series.cadence,
                recurring_series.expected_amount,
                recurring_series.next_expected_date,
                recurring_series.confidence,
                recurring_series.is_confirmed
            FROM recurring_series
            LEFT JOIN categories ON categories.id = recurring_series.category_id
            WHERE recurring_series.is_active = true
            ORDER BY recurring_series.next_expected_date NULLS LAST, recurring_series.name
            """
        ).fetchall()
    return [
        RecurringSeriesItem(
            id=_read_int(row[0]),
            name=str(row[1]),
            category=str(row[2]),
            cadence=str(row[3]),
            expected_amount=_format_money(row[4]),
            next_expected_date=_optional_date(row[5]),
            confidence=f"{Decimal(str(row[6])):.2f}",
            is_confirmed=bool(row[7]),
        )
        for row in rows
    ]


@dataclass(frozen=True)
class _RecurringCandidate:
    merchant_id: int | None
    category_id: int | None
    name: str
    expected_amount: Decimal
    expected_day_of_month: int
    last_seen_date: date
    transaction_ids: tuple[int, ...]


def _find_monthly_candidates(connection: Connection[tuple[object, ...]]) -> list[_RecurringCandidate]:
    rows = connection.execute(
        """
        SELECT
            enriched_transactions.merchant_id,
            enriched_transactions.category_id,
            COALESCE(merchants.name, raw_transactions.counterparty_name, 'Unknown'),
            round(avg(abs(raw_transactions.amount)), 2),
            round(avg(extract(day from raw_transactions.booking_date)))::int,
            max(raw_transactions.booking_date),
            array_agg(enriched_transactions.id ORDER BY raw_transactions.booking_date),
            count(DISTINCT to_char(raw_transactions.booking_date, 'YYYY-MM'))
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
            COALESCE(merchants.name, raw_transactions.counterparty_name, 'Unknown')
        HAVING count(DISTINCT to_char(raw_transactions.booking_date, 'YYYY-MM')) >= 2
        """
    ).fetchall()
    return [
        _RecurringCandidate(
            merchant_id=_optional_int(row[0]),
            category_id=_optional_int(row[1]),
            name=str(row[2]),
            expected_amount=Decimal(str(row[3])),
            expected_day_of_month=_read_int(row[4]),
            last_seen_date=_read_date(row[5]),
            transaction_ids=_read_int_tuple(row[6]),
        )
        for row in rows
    ]


def _upsert_recurring_series(connection: Connection[tuple[object, ...]], candidate: _RecurringCandidate) -> int:
    next_expected_date = _next_month_date(candidate.last_seen_date, candidate.expected_day_of_month)
    existing = connection.execute(
        """
        SELECT id
        FROM recurring_series
        WHERE name = %s AND cadence = 'monthly' AND is_active = true
        """,
        (candidate.name,),
    ).fetchone()
    if existing is not None:
        series_id = _read_int(existing[0])
        connection.execute(
            """
            UPDATE recurring_series
            SET
                merchant_id = %s,
                category_id = %s,
                expected_amount = %s,
                expected_day_of_month = %s,
                next_expected_date = %s,
                confidence = 0.80,
                updated_at = now()
            WHERE id = %s
            """,
            (
                candidate.merchant_id,
                candidate.category_id,
                candidate.expected_amount,
                candidate.expected_day_of_month,
                next_expected_date,
                series_id,
            ),
        )
        return series_id

    row = connection.execute(
        """
        INSERT INTO recurring_series (
            merchant_id,
            category_id,
            name,
            cadence,
            amount_mode,
            expected_amount,
            amount_tolerance,
            expected_day_of_month,
            next_expected_date,
            confidence,
            is_confirmed
        )
        VALUES (%s, %s, %s, 'monthly', 'fixed', %s, 2.00, %s, %s, 0.80, false)
        RETURNING id
        """,
        (
            candidate.merchant_id,
            candidate.category_id,
            candidate.name,
            candidate.expected_amount,
            candidate.expected_day_of_month,
            next_expected_date,
        ),
    ).fetchone()
    if row is None:
        raise RuntimeError("recurring series insert did not return an id")
    return _read_int(row[0])


def _link_transactions(
    connection: Connection[tuple[object, ...]],
    series_id: int,
    candidate: _RecurringCandidate,
) -> int:
    rows = connection.execute(
        """
        UPDATE enriched_transactions
        SET
            recurring_series_id = %s,
            is_recurring = true,
            is_fixed_cost = true,
            is_variable_cost = false,
            updated_at = now()
        WHERE id = ANY(%s)
        RETURNING id
        """,
        (series_id, list(candidate.transaction_ids)),
    ).fetchall()
    return len(rows)


def _next_month_date(last_seen_date: date, day_of_month: int) -> date:
    year = last_seen_date.year + 1 if last_seen_date.month == 12 else last_seen_date.year
    month = 1 if last_seen_date.month == 12 else last_seen_date.month + 1
    capped_day = min(day_of_month, 28)
    return date(year, month, capped_day)


def _format_money(value: object) -> str:
    amount = Decimal(str(value)).quantize(Decimal("0.01"))
    return f"EUR {amount:,.2f}"


def _optional_int(value: object) -> int | None:
    if value is None:
        return None
    return _read_int(value)


def _read_int(value: object) -> int:
    if not isinstance(value, int):
        raise RuntimeError(f"expected integer, got {type(value).__name__}")
    return value


def _read_int_tuple(value: object) -> tuple[int, ...]:
    if not isinstance(value, list):
        raise RuntimeError(f"expected integer list, got {type(value).__name__}")
    return tuple(_read_int(item) for item in value)


def _read_date(value: object) -> date:
    if not isinstance(value, date):
        raise RuntimeError(f"expected date, got {type(value).__name__}")
    return value


def _optional_date(value: object) -> date | None:
    if value is None:
        return None
    return _read_date(value)
