from __future__ import annotations

from collections.abc import Iterator

import psycopg
import pytest
from testcontainers.postgres import PostgresContainer

from app.bank.fake import FakeBankAdapter
from app.bank.sync import sync_bank_transactions
from app.migrate import run_migrations


@pytest.fixture(scope="module")
def migrated_postgres_url() -> Iterator[str]:
    with PostgresContainer(
        image="postgres:16-alpine",
        username="treasuri",
        password="treasuri",
        dbname="treasuri",
        driver=None,
    ) as postgres:
        database_url = postgres.get_connection_url(driver=None)
        run_migrations(database_url)
        yield database_url


def test_fake_bank_sync_imports_raw_transactions_idempotently(migrated_postgres_url: str) -> None:
    first_result = sync_bank_transactions(
        migrated_postgres_url,
        FakeBankAdapter(),
        account_iban="NL00FAKE0123456789",
    )
    second_result = sync_bank_transactions(
        migrated_postgres_url,
        FakeBankAdapter(),
        account_iban="NL00FAKE0123456789",
    )

    with psycopg.connect(migrated_postgres_url) as connection:
        raw_count = connection.execute("SELECT count(*) FROM raw_transactions").fetchone()
        sync_counts = connection.execute(
            """
            SELECT new_transaction_count, updated_transaction_count
            FROM sync_runs
            WHERE metadata_json @> '{"source":"bank-sync"}'
            ORDER BY id
            """
        ).fetchall()

    assert first_result.new_transaction_count == 3
    assert first_result.updated_transaction_count == 0
    assert second_result.new_transaction_count == 0
    assert second_result.updated_transaction_count == 3
    assert raw_count == (3,)
    assert sync_counts == [(3, 0), (0, 3)]
