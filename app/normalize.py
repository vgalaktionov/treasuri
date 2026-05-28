"""Raw-to-enriched transaction normalization."""

from __future__ import annotations

from dataclasses import dataclass

import psycopg


@dataclass(frozen=True)
class NormalizeResult:
    created_count: int


def normalize_raw_transactions(database_url: str) -> NormalizeResult:
    with psycopg.connect(database_url) as connection:
        with connection.transaction():
            result = connection.execute(
                """
                INSERT INTO enriched_transactions (
                    raw_transaction_id,
                    category_id,
                    is_income,
                    is_transfer,
                    is_savings,
                    is_fixed_cost,
                    is_variable_cost,
                    needs_review,
                    classification_method,
                    classification_confidence,
                    classification_reason
                )
                SELECT
                    raw_transactions.id,
                    unknown_category.id,
                    false,
                    false,
                    false,
                    false,
                    true,
                    true,
                    'normalized',
                    0,
                    'Created from raw transaction; deterministic classification not yet applied.'
                FROM raw_transactions
                CROSS JOIN categories AS unknown_category
                LEFT JOIN enriched_transactions
                    ON enriched_transactions.raw_transaction_id = raw_transactions.id
                WHERE unknown_category.name = 'Unknown'
                    AND enriched_transactions.id IS NULL
                RETURNING enriched_transactions.id
                """
            ).fetchall()

    return NormalizeResult(created_count=len(result))
