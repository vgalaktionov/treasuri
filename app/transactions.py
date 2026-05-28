"""Transaction and review inbox read models."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from decimal import Decimal

import psycopg


@dataclass(frozen=True)
class TransactionListItem:
    transaction_id: int
    booking_date: date
    amount: str
    merchant: str
    description: str
    category: str
    classification_method: str
    needs_review: bool
    flags: tuple[str, ...]


def list_transactions(database_url: str, *, needs_review: bool | None = None) -> list[TransactionListItem]:
    where_clause = "WHERE enriched_transactions.needs_review = %s" if needs_review is not None else ""
    params = (needs_review,) if needs_review is not None else ()
    with psycopg.connect(database_url) as connection:
        rows = connection.execute(
            f"""
            SELECT
                enriched_transactions.id,
                raw_transactions.booking_date,
                raw_transactions.amount,
                COALESCE(merchants.name, raw_transactions.counterparty_name, 'Unknown'),
                raw_transactions.description,
                COALESCE(categories.name, 'Unknown'),
                COALESCE(enriched_transactions.classification_method, 'none'),
                enriched_transactions.needs_review,
                enriched_transactions.is_income,
                enriched_transactions.is_transfer,
                enriched_transactions.is_savings,
                enriched_transactions.is_fixed_cost,
                enriched_transactions.is_recurring,
                enriched_transactions.is_one_off,
                enriched_transactions.is_excluded_from_budget
            FROM enriched_transactions
            JOIN raw_transactions ON raw_transactions.id = enriched_transactions.raw_transaction_id
            LEFT JOIN merchants ON merchants.id = enriched_transactions.merchant_id
            LEFT JOIN categories ON categories.id = enriched_transactions.category_id
            {where_clause}
            ORDER BY raw_transactions.booking_date DESC, enriched_transactions.id DESC
            LIMIT 100
            """,
            params,
        ).fetchall()

    return [_row_to_transaction(row) for row in rows]


def _row_to_transaction(row: tuple[object, ...]) -> TransactionListItem:
    return TransactionListItem(
        transaction_id=_expect_int(row[0]),
        booking_date=_expect_date(row[1]),
        amount=_format_money(row[2]),
        merchant=str(row[3]),
        description=str(row[4]),
        category=str(row[5]),
        classification_method=str(row[6]),
        needs_review=bool(row[7]),
        flags=_flags(row),
    )


def _flags(row: tuple[object, ...]) -> tuple[str, ...]:
    flags: list[str] = []
    flag_columns = (
        ("income", row[8]),
        ("transfer", row[9]),
        ("savings", row[10]),
        ("fixed", row[11]),
        ("recurring", row[12]),
        ("one-off", row[13]),
        ("excluded", row[14]),
    )
    for label, enabled in flag_columns:
        if enabled:
            flags.append(label)
    return tuple(flags)


def _format_money(value: object) -> str:
    amount = Decimal(str(value)).quantize(Decimal("0.01"))
    sign = "-" if amount < 0 else ""
    absolute = abs(amount)
    return f"{sign}EUR {absolute:,.2f}"


def _expect_int(value: object) -> int:
    if not isinstance(value, int):
        raise RuntimeError(f"expected integer id, got {type(value).__name__}")
    return value


def _expect_date(value: object) -> date:
    if not isinstance(value, date):
        raise RuntimeError(f"expected date, got {type(value).__name__}")
    return value
