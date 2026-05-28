from __future__ import annotations

from collections.abc import Iterator

import psycopg
import pytest
from testcontainers.postgres import PostgresContainer

from app.config import AppConfig
from app.jobs.enqueue import SYNC_NOW_ENTRYPOINT, enqueue_sync_now
from app.jobs.worker import run_until_drained
from app.migrate import run_migrations


@pytest.fixture
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


def test_enqueue_sync_now_writes_pgqueuer_job(migrated_postgres_url: str) -> None:
    job_id = enqueue_sync_now(migrated_postgres_url)

    with psycopg.connect(migrated_postgres_url) as connection:
        row = connection.execute(
            "SELECT entrypoint, payload, status, dedupe_key FROM pgqueuer WHERE id = %s",
            (job_id,),
        ).fetchone()

    assert row == (SYNC_NOW_ENTRYPOINT, b"{}", "queued", SYNC_NOW_ENTRYPOINT)


def test_worker_drains_sync_now_job(migrated_postgres_url: str) -> None:
    job_id = enqueue_sync_now(migrated_postgres_url)
    config = AppConfig(
        app_env="test",
        secret_key="test-secret",
        database_url=migrated_postgres_url,
        oidc_enabled=False,
        llm_enabled=False,
        bank_provider="fake",
    )

    run_until_drained(config)

    with psycopg.connect(migrated_postgres_url) as connection:
        job_status = connection.execute("SELECT status FROM pgqueuer WHERE id = %s", (job_id,)).fetchone()
        job_log_status = connection.execute(
            "SELECT status FROM pgqueuer_log WHERE job_id = %s ORDER BY created DESC LIMIT 1",
            (job_id,),
        ).fetchone()
        raw_count = connection.execute("SELECT count(*) FROM raw_transactions").fetchone()
        forecast_count = connection.execute("SELECT count(*) FROM monthly_forecasts").fetchone()

    assert job_status is None
    assert job_log_status == ("successful",)
    assert raw_count == (3,)
    assert forecast_count == (1,)
