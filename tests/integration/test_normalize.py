from __future__ import annotations

from collections.abc import Iterator

import psycopg
import pytest
from testcontainers.postgres import PostgresContainer

from app.bank.fake import FakeBankAdapter
from app.bank.sync import sync_bank_transactions
from app.migrate import run_migrations
from app.normalize import normalize_raw_transactions


@pytest.fixture(scope="module")
def synced_postgres_url() -> Iterator[str]:
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
        yield database_url


def test_normalize_raw_transactions_creates_enriched_rows_idempotently(synced_postgres_url: str) -> None:
    first_result = normalize_raw_transactions(synced_postgres_url)
    second_result = normalize_raw_transactions(synced_postgres_url)

    with psycopg.connect(synced_postgres_url) as connection:
        rows = connection.execute(
            """
            SELECT categories.name, enriched_transactions.needs_review, enriched_transactions.classification_method
            FROM enriched_transactions
            JOIN categories ON categories.id = enriched_transactions.category_id
            ORDER BY enriched_transactions.id
            """
        ).fetchall()

    assert first_result.created_count == 3
    assert second_result.created_count == 0
    assert rows == [
        ("Unknown", True, "normalized"),
        ("Unknown", True, "normalized"),
        ("Unknown", True, "normalized"),
    ]
