from __future__ import annotations

from collections.abc import Iterator

import psycopg
import pytest
from testcontainers.postgres import PostgresContainer

from app.bank.fake import FakeBankAdapter
from app.bank.sync import sync_bank_transactions
from app.classify.service import classify_transactions
from app.migrate import run_migrations
from app.normalize import normalize_raw_transactions


@pytest.fixture(scope="module")
def normalized_postgres_url() -> Iterator[str]:
    with PostgresContainer(
        image="postgres:16-alpine",
        username="treasuri",
        password="treasuri",
        dbname="treasuri",
        driver=None,
    ) as postgres:
        database_url = postgres.get_connection_url(driver=None)
        run_migrations(database_url)
        sync_bank_transactions(database_url, FakeBankAdapter(), account_iban="NL00FAKE0123456789")
        normalize_raw_transactions(database_url)
        yield database_url


def test_classify_transactions_applies_rules_before_aliases(normalized_postgres_url: str) -> None:
    with psycopg.connect(normalized_postgres_url) as connection:
        with connection.transaction():
            connection.execute(
                """
                INSERT INTO merchants (name, normalized_name, default_category_id)
                VALUES (
                    'Sample Supermarket',
                    'sample supermarket',
                    (SELECT id FROM categories WHERE name = 'Groceries')
                )
                """
            )
            connection.execute(
                """
                INSERT INTO merchant_aliases (merchant_id, match_text, match_type, priority)
                VALUES (
                    (SELECT id FROM merchants WHERE normalized_name = 'sample supermarket'),
                    'Sample Supermarket',
                    'contains',
                    100
                )
                """
            )
            connection.execute(
                """
                INSERT INTO categorization_rules (
                    name,
                    priority,
                    field,
                    operator,
                    pattern,
                    category_id,
                    set_is_income
                )
                VALUES (
                    'Salary income',
                    10,
                    'description',
                    'contains',
                    'salary',
                    (SELECT id FROM categories WHERE name = 'Income'),
                    true
                )
                """
            )

    result = classify_transactions(normalized_postgres_url)

    with psycopg.connect(normalized_postgres_url) as connection:
        rows = connection.execute(
            """
            SELECT
                raw_transactions.description,
                categories.name,
                merchants.name,
                enriched_transactions.needs_review,
                enriched_transactions.classification_method
            FROM enriched_transactions
            JOIN raw_transactions ON raw_transactions.id = enriched_transactions.raw_transaction_id
            LEFT JOIN categories ON categories.id = enriched_transactions.category_id
            LEFT JOIN merchants ON merchants.id = enriched_transactions.merchant_id
            ORDER BY raw_transactions.description
            """
        ).fetchall()

    assert result.classified_count == 3
    assert result.review_count == 1
    assert rows == [
        ("Groceries sample", "Groceries", "Sample Supermarket", False, "merchant_alias"),
        ("Monthly salary sample", "Income", None, False, "rule"),
        ("Needs review sample", "Unknown", None, True, "uncategorized"),
    ]
