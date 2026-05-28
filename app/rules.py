"""Categorization rule preview and creation."""

from __future__ import annotations

from dataclasses import dataclass

import psycopg
from psycopg import Connection


@dataclass(frozen=True)
class RuleDraft:
    source_transaction_id: int
    name: str
    field: str
    operator: str
    pattern: str
    category_name: str
    merchant_name: str | None


@dataclass(frozen=True)
class RulePreview:
    draft: RuleDraft
    match_count: int
    would_change_count: int
    already_correct_count: int
    manual_overrides_skipped_count: int


def draft_rule_from_transaction(database_url: str, transaction_id: int) -> RuleDraft:
    with psycopg.connect(database_url) as connection:
        row = connection.execute(
            """
            SELECT
                raw_transactions.counterparty_name,
                raw_transactions.description,
                categories.name,
                merchants.name
            FROM enriched_transactions
            JOIN raw_transactions ON raw_transactions.id = enriched_transactions.raw_transaction_id
            LEFT JOIN categories ON categories.id = enriched_transactions.category_id
            LEFT JOIN merchants ON merchants.id = enriched_transactions.merchant_id
            WHERE enriched_transactions.id = %s
            """,
            (transaction_id,),
        ).fetchone()
    if row is None:
        raise ValueError(f"transaction not found: {transaction_id}")

    counterparty = _optional_str(row[0])
    description = str(row[1])
    pattern = counterparty or description
    field = "counterparty_name" if counterparty else "description"
    return RuleDraft(
        source_transaction_id=transaction_id,
        name=f"Classify {pattern}",
        field=field,
        operator="contains",
        pattern=pattern,
        category_name=str(row[2] or "Unknown"),
        merchant_name=_optional_str(row[3]),
    )


def preview_rule(database_url: str, draft: RuleDraft) -> RulePreview:
    with psycopg.connect(database_url) as connection:
        rows = connection.execute(
            """
            SELECT
                categories.name,
                manual_overrides.id IS NOT NULL
            FROM enriched_transactions
            JOIN raw_transactions ON raw_transactions.id = enriched_transactions.raw_transaction_id
            LEFT JOIN categories ON categories.id = enriched_transactions.category_id
            LEFT JOIN manual_overrides
                ON manual_overrides.enriched_transaction_id = enriched_transactions.id
            WHERE
                CASE
                    WHEN %s = 'counterparty_name'
                        THEN raw_transactions.counterparty_name ILIKE '%%' || %s || '%%'
                    ELSE raw_transactions.description ILIKE '%%' || %s || '%%'
                END
            """,
            (draft.field, draft.pattern, draft.pattern),
        ).fetchall()

    manual_skipped = sum(1 for row in rows if row[1])
    eligible_rows = [row for row in rows if not row[1]]
    already_correct = sum(1 for row in eligible_rows if row[0] == draft.category_name)
    would_change = len(eligible_rows) - already_correct

    return RulePreview(
        draft=draft,
        match_count=len(rows),
        would_change_count=would_change,
        already_correct_count=already_correct,
        manual_overrides_skipped_count=manual_skipped,
    )


def create_rule(database_url: str, draft: RuleDraft) -> int:
    with psycopg.connect(database_url) as connection:
        with connection.transaction():
            merchant_id = _merchant_id(connection, draft.merchant_name)
            row = connection.execute(
                """
                INSERT INTO categorization_rules (
                    name,
                    priority,
                    field,
                    operator,
                    pattern,
                    category_id,
                    merchant_id,
                    created_from_transaction_id
                )
                VALUES (
                    %s,
                    100,
                    %s,
                    %s,
                    %s,
                    (SELECT id FROM categories WHERE name = %s),
                    %s,
                    %s
                )
                RETURNING id
                """,
                (
                    draft.name,
                    draft.field,
                    draft.operator,
                    draft.pattern,
                    draft.category_name,
                    merchant_id,
                    draft.source_transaction_id,
                ),
            ).fetchone()
    if row is None:
        raise RuntimeError("rule insert did not return an id")
    return _read_int(row[0])


def _merchant_id(connection: Connection[tuple[object, ...]], merchant_name: str | None) -> int | None:
    if merchant_name is None:
        return None
    row = connection.execute("SELECT id FROM merchants WHERE name = %s", (merchant_name,)).fetchone()
    if row is None:
        return None
    return _read_int(row[0])


def _optional_str(value: object) -> str | None:
    if value is None:
        return None
    return str(value)


def _read_int(value: object) -> int:
    if not isinstance(value, int):
        raise RuntimeError(f"expected integer, got {type(value).__name__}")
    return value
