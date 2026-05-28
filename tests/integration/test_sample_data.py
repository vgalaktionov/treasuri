from __future__ import annotations

from collections.abc import Iterator

import psycopg
import pytest
from testcontainers.postgres import PostgresContainer

from app.config import AppConfig
from app.migrate import run_migrations
from app.sample_data import SAMPLE_TRANSACTIONS, load_sample_data
from app.web import create_app


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


def test_load_sample_data_is_idempotent(migrated_postgres_url: str) -> None:
    load_sample_data(migrated_postgres_url)
    load_sample_data(migrated_postgres_url)

    with psycopg.connect(migrated_postgres_url) as connection:
        raw_count = connection.execute("SELECT count(*) FROM raw_transactions").fetchone()
        enriched_count = connection.execute("SELECT count(*) FROM enriched_transactions").fetchone()
        review_count = connection.execute(
            "SELECT count(*) FROM enriched_transactions WHERE needs_review = true"
        ).fetchone()
        forecast_count = connection.execute(
            "SELECT count(*) FROM monthly_forecasts WHERE year_month = '2026-05'"
        ).fetchone()
        sync_count = connection.execute(
            'SELECT count(*) FROM sync_runs WHERE metadata_json @> \'{"source":"sample"}\''
        ).fetchone()

    assert raw_count == (len(SAMPLE_TRANSACTIONS),)
    assert enriched_count == (len(SAMPLE_TRANSACTIONS),)
    assert review_count == (1,)
    assert forecast_count == (1,)
    assert sync_count == (1,)


def test_dashboard_renders_database_backed_sample_summary(migrated_postgres_url: str) -> None:
    load_sample_data(migrated_postgres_url)
    app = create_app(
        AppConfig(
            app_env="test",
            secret_key="test-secret",
            database_url=migrated_postgres_url,
            allowed_emails=("dev-user@example.test",),
            oidc_enabled=False,
            oidc_testing_profile={
                "sub": "dev-user",
                "email": "dev-user@example.test",
            },
            oidc_cookie_secure=False,
            llm_enabled=False,
        ),
        {"TESTING": True},
    )

    response = app.test_client().get("/")

    assert response.status_code == 200
    assert b"May 2026" in response.data
    assert b"EUR 558" in response.data
    assert b"EUR 93/day" in response.data
    assert b"Forecast inputs" in response.data
    assert b"Fixed costs upcoming" in response.data
    assert b"EUR 620" in response.data
    assert b"predicted_variable_remaining" in response.data
    assert b"1 transaction needs review" in response.data
    assert b"fake completed at 2026-05-28 08:00" in response.data
