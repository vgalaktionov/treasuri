from __future__ import annotations

from collections.abc import Iterator

import psycopg
import pytest
from testcontainers.postgres import PostgresContainer

from app.admin import seed_categories
from app.categories import DEFAULT_CATEGORIES
from app.migrate import run_migrations


@pytest.fixture(scope="module")
def postgres_url() -> Iterator[str]:
    with PostgresContainer(
        image="postgres:16-alpine",
        username="treasuri",
        password="treasuri",
        dbname="treasuri",
        driver=None,
    ) as postgres:
        yield postgres.get_connection_url(driver=None)


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

    assert first_run == ["0001_initial", "0002_seed_categories", "0003_pgqueuer"]
    assert second_run == []
    assert {
        "accounts",
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
    assert migration_versions == ["0001_initial", "0002_seed_categories", "0003_pgqueuer"]


def test_seed_categories_admin_command_is_idempotent(postgres_url: str) -> None:
    checked_first = seed_categories(postgres_url)
    checked_second = seed_categories(postgres_url)

    with psycopg.connect(postgres_url) as connection:
        category_count = connection.execute("SELECT count(*) FROM categories").fetchone()

    assert checked_first == len(DEFAULT_CATEGORIES)
    assert checked_second == len(DEFAULT_CATEGORIES)
    assert category_count == (len(DEFAULT_CATEGORIES),)
