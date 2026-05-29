"""Review inbox write actions."""

from __future__ import annotations

import json
from dataclasses import dataclass

import psycopg
from psycopg import Connection


@dataclass(frozen=True)
class ReviewCorrection:
    transaction_id: int
    category_name: str
    merchant_name: str | None
    notes: str | None = None
    create_alias: bool = False
    is_transfer: bool = False
    is_savings: bool = False
    is_one_off: bool = False
    is_excluded_from_budget: bool = False


@dataclass(frozen=True)
class ReviewCorrectionResult:
    corrected_count: int
    similar_count: int = 0


def list_category_names(database_url: str) -> list[str]:
    with psycopg.connect(database_url) as connection:
        rows = connection.execute("SELECT name FROM categories ORDER BY name").fetchall()
    return [str(row[0]) for row in rows]


def apply_review_correction(database_url: str, correction: ReviewCorrection) -> ReviewCorrectionResult:
    with psycopg.connect(database_url) as connection:
        with connection.transaction():
            category_id = _category_id(connection, correction.category_name)
            merchant_id = _merchant_id(connection, correction.merchant_name, category_id)
            _upsert_manual_override(connection, correction, category_id, merchant_id)
            if correction.create_alias and merchant_id is not None:
                _upsert_merchant_alias(connection, correction.transaction_id, merchant_id)
            _update_enriched_transaction(connection, correction, category_id, merchant_id)
    return ReviewCorrectionResult(corrected_count=1)


def apply_review_correction_to_similar(database_url: str, correction: ReviewCorrection) -> ReviewCorrectionResult:
    with psycopg.connect(database_url) as connection:
        with connection.transaction():
            category_id = _category_id(connection, correction.category_name)
            merchant_id = _merchant_id(connection, correction.merchant_name, category_id)
            similar_ids = _similar_transaction_ids(connection, correction.transaction_id)
            _upsert_manual_override(connection, correction, category_id, merchant_id)
            if correction.create_alias and merchant_id is not None:
                _upsert_merchant_alias(connection, correction.transaction_id, merchant_id)
            _update_enriched_transaction(connection, correction, category_id, merchant_id)
            for transaction_id in similar_ids:
                similar_correction = ReviewCorrection(
                    transaction_id=transaction_id,
                    category_name=correction.category_name,
                    merchant_name=correction.merchant_name,
                    notes=correction.notes,
                    create_alias=False,
                    is_transfer=correction.is_transfer,
                    is_savings=correction.is_savings,
                    is_one_off=correction.is_one_off,
                    is_excluded_from_budget=correction.is_excluded_from_budget,
                )
                _upsert_manual_override(connection, similar_correction, category_id, merchant_id)
                _update_enriched_transaction(connection, similar_correction, category_id, merchant_id)
    return ReviewCorrectionResult(corrected_count=1 + len(similar_ids), similar_count=len(similar_ids))


def _category_id(connection: Connection[tuple[object, ...]], category_name: str) -> int:
    row = connection.execute("SELECT id FROM categories WHERE name = %s", (category_name,)).fetchone()
    if row is None:
        raise ValueError(f"unknown category: {category_name}")
    return _read_int(row[0])


def _merchant_id(connection: Connection[tuple[object, ...]], merchant_name: str | None, category_id: int) -> int | None:
    if merchant_name is None or merchant_name.strip() == "":
        return None
    normalized_name = merchant_name.strip().casefold()
    row = connection.execute(
        """
        INSERT INTO merchants (name, normalized_name, default_category_id)
        VALUES (%s, %s, %s)
        ON CONFLICT (normalized_name)
        DO UPDATE SET default_category_id = EXCLUDED.default_category_id, updated_at = now()
        RETURNING id
        """,
        (merchant_name.strip(), normalized_name, category_id),
    ).fetchone()
    if row is None:
        raise RuntimeError("merchant upsert did not return an id")
    return _read_int(row[0])


def _upsert_manual_override(
    connection: Connection[tuple[object, ...]],
    correction: ReviewCorrection,
    category_id: int,
    merchant_id: int | None,
) -> None:
    connection.execute(
        """
        INSERT INTO manual_overrides (
            enriched_transaction_id,
            category_id,
            merchant_id,
            flags_json,
            notes
        )
        VALUES (%s, %s, %s, %s::jsonb, %s)
        ON CONFLICT (enriched_transaction_id)
        DO UPDATE SET
            category_id = EXCLUDED.category_id,
            merchant_id = EXCLUDED.merchant_id,
            flags_json = EXCLUDED.flags_json,
            notes = EXCLUDED.notes,
            updated_at = now()
        """,
        (
            correction.transaction_id,
            category_id,
            merchant_id,
            json.dumps(_flags_json(correction), sort_keys=True),
            correction.notes,
        ),
    )


def _upsert_merchant_alias(
    connection: Connection[tuple[object, ...]],
    transaction_id: int,
    merchant_id: int,
) -> None:
    row = connection.execute(
        """
        SELECT
            NULLIF(trim(raw_transactions.counterparty_name), ''),
            NULLIF(trim(raw_transactions.description), '')
        FROM enriched_transactions
        JOIN raw_transactions ON raw_transactions.id = enriched_transactions.raw_transaction_id
        WHERE enriched_transactions.id = %s
        """,
        (transaction_id,),
    ).fetchone()
    if row is None:
        raise ValueError(f"unknown transaction: {transaction_id}")

    match_text = _optional_str(row[0]) or _optional_str(row[1])
    if match_text is None:
        return

    connection.execute(
        """
        INSERT INTO merchant_aliases (merchant_id, match_text, match_type, priority)
        SELECT %s, %s, 'contains', 50
        WHERE NOT EXISTS (
            SELECT 1
            FROM merchant_aliases
            WHERE merchant_id = %s
                AND match_text = %s
                AND match_type = 'contains'
        )
        """,
        (merchant_id, match_text, merchant_id, match_text),
    )


def _similar_transaction_ids(connection: Connection[tuple[object, ...]], transaction_id: int) -> list[int]:
    row = connection.execute(
        """
        SELECT
            NULLIF(trim(raw_transactions.counterparty_name), ''),
            NULLIF(trim(raw_transactions.description), '')
        FROM enriched_transactions
        JOIN raw_transactions ON raw_transactions.id = enriched_transactions.raw_transaction_id
        WHERE enriched_transactions.id = %s
        """,
        (transaction_id,),
    ).fetchone()
    if row is None:
        raise ValueError(f"unknown transaction: {transaction_id}")

    counterparty = _optional_str(row[0])
    description = _optional_str(row[1])
    if counterparty is not None:
        rows = connection.execute(
            """
            SELECT enriched_transactions.id
            FROM enriched_transactions
            JOIN raw_transactions ON raw_transactions.id = enriched_transactions.raw_transaction_id
            LEFT JOIN manual_overrides
                ON manual_overrides.enriched_transaction_id = enriched_transactions.id
            WHERE enriched_transactions.id <> %s
                AND manual_overrides.id IS NULL
                AND lower(raw_transactions.counterparty_name) = lower(%s)
            ORDER BY raw_transactions.booking_date DESC, enriched_transactions.id DESC
            """,
            (transaction_id, counterparty),
        ).fetchall()
    elif description is not None:
        rows = connection.execute(
            """
            SELECT enriched_transactions.id
            FROM enriched_transactions
            JOIN raw_transactions ON raw_transactions.id = enriched_transactions.raw_transaction_id
            LEFT JOIN manual_overrides
                ON manual_overrides.enriched_transaction_id = enriched_transactions.id
            WHERE enriched_transactions.id <> %s
                AND manual_overrides.id IS NULL
                AND lower(raw_transactions.description) = lower(%s)
            ORDER BY raw_transactions.booking_date DESC, enriched_transactions.id DESC
            """,
            (transaction_id, description),
        ).fetchall()
    else:
        return []
    return [_read_int(row[0]) for row in rows]


def _update_enriched_transaction(
    connection: Connection[tuple[object, ...]],
    correction: ReviewCorrection,
    category_id: int,
    merchant_id: int | None,
) -> None:
    connection.execute(
        """
        UPDATE enriched_transactions
        SET
            category_id = %s,
            merchant_id = %s,
            is_transfer = %s,
            is_savings = %s,
            is_one_off = %s,
            is_excluded_from_budget = %s,
            needs_review = false,
            classification_method = 'manual_override',
            classification_confidence = 1,
            classification_reason = 'User correction from review inbox.',
            classification_model = NULL,
            classification_runtime = NULL,
            classification_prompt_version = NULL,
            updated_at = now()
        WHERE id = %s
        """,
        (
            category_id,
            merchant_id,
            correction.is_transfer,
            correction.is_savings,
            correction.is_one_off,
            correction.is_excluded_from_budget,
            correction.transaction_id,
        ),
    )


def _flags_json(correction: ReviewCorrection) -> dict[str, bool]:
    return {
        "is_transfer": correction.is_transfer,
        "is_savings": correction.is_savings,
        "is_one_off": correction.is_one_off,
        "is_excluded_from_budget": correction.is_excluded_from_budget,
    }


def _read_int(value: object) -> int:
    if not isinstance(value, int):
        raise RuntimeError(f"expected integer, got {type(value).__name__}")
    return value


def _optional_str(value: object) -> str | None:
    if value is None:
        return None
    return str(value)
