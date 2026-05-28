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


def list_category_names(database_url: str) -> list[str]:
    with psycopg.connect(database_url) as connection:
        rows = connection.execute("SELECT name FROM categories ORDER BY name").fetchall()
    return [str(row[0]) for row in rows]


def apply_review_correction(database_url: str, correction: ReviewCorrection) -> None:
    with psycopg.connect(database_url) as connection:
        with connection.transaction():
            category_id = _category_id(connection, correction.category_name)
            merchant_id = _merchant_id(connection, correction.merchant_name, category_id)
            _upsert_manual_override(connection, correction, category_id, merchant_id)
            _update_enriched_transaction(connection, correction, category_id, merchant_id)


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
            json.dumps({}, sort_keys=True),
            correction.notes,
        ),
    )


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
            needs_review = false,
            classification_method = 'manual_override',
            classification_confidence = 1,
            classification_reason = 'User correction from review inbox.',
            updated_at = now()
        WHERE id = %s
        """,
        (category_id, merchant_id, correction.transaction_id),
    )


def _read_int(value: object) -> int:
    if not isinstance(value, int):
        raise RuntimeError(f"expected integer, got {type(value).__name__}")
    return value
