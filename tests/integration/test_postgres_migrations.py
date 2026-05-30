from __future__ import annotations

from collections.abc import Iterator
from time import monotonic, sleep

import psycopg
import pytest
from testcontainers.postgres import PostgresContainer

from app.admin import seed_categories
from app.categories import DEFAULT_CATEGORIES
from app.migrate import run_migrations


@pytest.fixture
def postgres_url() -> Iterator[str]:
    with PostgresContainer(
        image="postgres:16-alpine",
        username="treasuri",
        password="treasuri",
        dbname="treasuri",
        driver=None,
    ) as postgres:
        database_url = postgres.get_connection_url(driver=None)
        _wait_for_postgres(database_url)
        yield database_url


def test_migrations_apply_from_clean_postgres_and_are_idempotent(postgres_url: str) -> None:
    first_run = run_migrations(postgres_url)
    second_run = run_migrations(postgres_url)

    with psycopg.connect(postgres_url) as connection:
        tables = {
            row[0]
            for row in connection.execute(
                "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'"
            )
        }
        category_count = connection.execute("SELECT count(*) FROM categories").fetchone()
        migration_versions = [
            row[0] for row in connection.execute("SELECT version FROM schema_migrations ORDER BY version")
        ]

    assert first_run == [
        "0001_initial",
        "0002_seed_categories",
        "0003_pgqueuer",
        "0004_classification_runtime",
        "0005_account_balance_snapshots",
    ]
    assert second_run == []
    assert {
        "accounts",
        "account_balance_snapshots",
        "app_settings",
        "categories",
        "categorization_rules",
        "enriched_transactions",
        "export_files",
        "export_runs",
        "manual_overrides",
        "merchant_aliases",
        "merchants",
        "monthly_forecasts",
        "pgqueuer",
        "pgqueuer_log",
        "pgqueuer_schedules",
        "pgqueuer_statistics",
        "raw_transactions",
        "recurring_series",
        "schema_migrations",
        "sync_runs",
    } <= tables
    assert category_count == (len(DEFAULT_CATEGORIES),)
    assert migration_versions == [
        "0001_initial",
        "0002_seed_categories",
        "0003_pgqueuer",
        "0004_classification_runtime",
        "0005_account_balance_snapshots",
    ]


def test_seed_categories_admin_command_is_idempotent(postgres_url: str) -> None:
    run_migrations(postgres_url)

    checked_first = seed_categories(postgres_url)
    checked_second = seed_categories(postgres_url)

    with psycopg.connect(postgres_url) as connection:
        category_count = connection.execute("SELECT count(*) FROM categories").fetchone()

    assert checked_first == len(DEFAULT_CATEGORIES)
    assert checked_second == len(DEFAULT_CATEGORIES)
    assert category_count == (len(DEFAULT_CATEGORIES),)


def _wait_for_postgres(database_url: str) -> None:
    deadline = monotonic() + 10
    while True:
        try:
            with psycopg.connect(database_url):
                return
        except psycopg.OperationalError:
            if monotonic() >= deadline:
                raise
            sleep(0.1)
