"""Transaction and review inbox read models."""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import date
from decimal import Decimal, InvalidOperation
from typing import LiteralString, cast

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


@dataclass(frozen=True)
class RawTransactionDetails:
    transaction_id: int
    booking_date: date
    amount: str
    merchant: str
    description: str
    category: str
    details: tuple[tuple[str, str], ...]
    payload_json: str


@dataclass(frozen=True)
class TransactionFilters:
    query: str = ""
    month: str = ""
    category: str = ""
    min_amount: str = ""
    max_amount: str = ""
    kind: str = ""
    needs_review: bool | None = None

    @property
    def has_any(self) -> bool:
        return bool(
            self.query
            or self.month
            or self.category
            or self.min_amount
            or self.max_amount
            or self.kind
            or self.needs_review is not None
        )

    @property
    def has_advanced(self) -> bool:
        return bool(self.month or self.category or self.min_amount or self.max_amount or self.kind or self.needs_review)


def list_transactions(
    database_url: str,
    *,
    needs_review: bool | None = None,
    filters: TransactionFilters | None = None,
) -> list[TransactionListItem]:
    active_filters = filters or TransactionFilters(needs_review=needs_review)
    if needs_review is not None:
        active_filters = TransactionFilters(
            query=active_filters.query,
            month=active_filters.month,
            category=active_filters.category,
            min_amount=active_filters.min_amount,
            max_amount=active_filters.max_amount,
            kind=active_filters.kind,
            needs_review=needs_review,
        )
    where_clause, params = _build_where_clause(active_filters)
    with psycopg.connect(database_url) as connection:
        rows = connection.execute(
            cast(
                LiteralString,
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
            ),
            tuple(params),
        ).fetchall()

    return [_row_to_transaction(row) for row in rows]


def get_transaction_raw_details(database_url: str, transaction_id: int) -> RawTransactionDetails:
    with psycopg.connect(database_url) as connection:
        row = connection.execute(
            """
            SELECT
                enriched_transactions.id,
                raw_transactions.booking_date,
                raw_transactions.amount,
                COALESCE(merchants.name, raw_transactions.counterparty_name, 'Unknown'),
                raw_transactions.description,
                COALESCE(categories.name, 'Unknown'),
                accounts.name,
                accounts.iban,
                raw_transactions.provider,
                raw_transactions.provider_transaction_id,
                raw_transactions.source_hash,
                raw_transactions.value_date,
                raw_transactions.currency,
                raw_transactions.counterparty_name,
                raw_transactions.counterparty_iban,
                raw_transactions.raw_payload_json,
                raw_transactions.first_seen_at,
                raw_transactions.last_seen_at
            FROM enriched_transactions
            JOIN raw_transactions ON raw_transactions.id = enriched_transactions.raw_transaction_id
            JOIN accounts ON accounts.id = raw_transactions.account_id
            LEFT JOIN merchants ON merchants.id = enriched_transactions.merchant_id
            LEFT JOIN categories ON categories.id = enriched_transactions.category_id
            WHERE enriched_transactions.id = %s
            """,
            (transaction_id,),
        ).fetchone()
    if row is None:
        raise ValueError(f"transaction not found: {transaction_id}")
    return _row_to_raw_details(row)


def _build_where_clause(filters: TransactionFilters) -> tuple[str, list[object]]:
    clauses: list[str] = []
    params: list[object] = []
    if filters.needs_review is not None:
        clauses.append("enriched_transactions.needs_review = %s")
        params.append(filters.needs_review)
    if filters.query:
        clauses.append(
            """
            (
                raw_transactions.description ILIKE %s
                OR raw_transactions.counterparty_name ILIKE %s
                OR merchants.name ILIKE %s
            )
            """
        )
        like_value = f"%{filters.query}%"
        params.extend([like_value, like_value, like_value])
    if filters.month:
        clauses.append("to_char(raw_transactions.booking_date, 'YYYY-MM') = %s")
        params.append(filters.month)
    if filters.category:
        clauses.append("categories.name = %s")
        params.append(filters.category)
    min_amount = _parse_amount_filter(filters.min_amount)
    if min_amount is not None:
        clauses.append("ABS(raw_transactions.amount) >= %s")
        params.append(min_amount)
    elif filters.min_amount:
        clauses.append("FALSE")
    max_amount = _parse_amount_filter(filters.max_amount)
    if max_amount is not None:
        clauses.append("ABS(raw_transactions.amount) <= %s")
        params.append(max_amount)
    elif filters.max_amount:
        clauses.append("FALSE")
    kind_clause = _kind_clause(filters.kind)
    if kind_clause:
        clauses.append(kind_clause)
    if not clauses:
        return "", params
    return "WHERE " + " AND ".join(clauses), params


def _parse_amount_filter(value: str) -> Decimal | None:
    if not value:
        return None
    try:
        return abs(Decimal(value.strip().replace(",", "")))
    except InvalidOperation:
        return None


def _kind_clause(kind: str) -> str:
    return {
        "income": "enriched_transactions.is_income",
        "spending": (
            "raw_transactions.amount < 0 "
            "AND NOT enriched_transactions.is_transfer "
            "AND NOT enriched_transactions.is_excluded_from_budget"
        ),
        "transfer": "enriched_transactions.is_transfer",
        "savings": "enriched_transactions.is_savings",
        "fixed": "enriched_transactions.is_fixed_cost",
        "recurring": "enriched_transactions.is_recurring",
        "one_off": "enriched_transactions.is_one_off",
        "excluded": "enriched_transactions.is_excluded_from_budget",
    }.get(kind, "")


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


def _row_to_raw_details(row: tuple[object, ...]) -> RawTransactionDetails:
    payload = row[15] if row[15] is not None else {}
    return RawTransactionDetails(
        transaction_id=_expect_int(row[0]),
        booking_date=_expect_date(row[1]),
        amount=_format_money(row[2]),
        merchant=str(row[3]),
        description=str(row[4]),
        category=str(row[5]),
        details=(
            ("Account", str(row[6])),
            ("IBAN", _display_optional(row[7])),
            ("Provider", str(row[8])),
            ("Provider transaction ID", _display_optional(row[9])),
            ("Source hash", str(row[10])),
            ("Value date", _display_optional(row[11])),
            ("Currency", str(row[12])),
            ("Counterparty", _display_optional(row[13])),
            ("Counterparty IBAN", _display_optional(row[14])),
            ("First seen", str(row[16])),
            ("Last seen", str(row[17])),
        ),
        payload_json=json.dumps(payload, indent=2, sort_keys=True),
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


def _display_optional(value: object) -> str:
    if value is None or value == "":
        return "None"
    return str(value)
