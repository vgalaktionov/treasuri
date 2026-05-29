from __future__ import annotations

import json
from collections.abc import Iterator

import psycopg
import pytest
from testcontainers.postgres import PostgresContainer

from app.config import AppConfig
from app.jobs.enqueue import (
    BACKFILL_RULE_ENTRYPOINT,
    GENERATE_XLSX_EXPORT_ENTRYPOINT,
    REQUIRED_JOB_ENTRYPOINTS,
    SYNC_ABN_TRANSACTIONS_ENTRYPOINT,
    SYNC_NOW_ENTRYPOINT,
    enqueue_backfill_rule,
    enqueue_generate_xlsx_export,
    enqueue_sync_abn_transactions,
    enqueue_sync_now,
)
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


def test_required_job_entrypoints_match_prd() -> None:
    assert REQUIRED_JOB_ENTRYPOINTS == (
        "sync_abn_transactions",
        "normalize_transactions",
        "classify_transactions",
        "detect_recurring",
        "update_monthly_forecast",
        "generate_xlsx_export",
        "backfill_rule",
    )


def test_enqueue_payload_jobs_write_json_payloads(migrated_postgres_url: str) -> None:
    export_job_id = enqueue_generate_xlsx_export(migrated_postgres_url, created_by="dev-user@example.test")
    backfill_job_id = enqueue_backfill_rule(migrated_postgres_url, 42)

    with psycopg.connect(migrated_postgres_url) as connection:
        rows = connection.execute(
            """
            SELECT id, entrypoint, payload, status
            FROM pgqueuer
            WHERE id = ANY(%s)
            ORDER BY id
            """,
            ([export_job_id, backfill_job_id],),
        ).fetchall()

    assert [(row[1], json.loads(row[2]), row[3]) for row in rows] == [
        (GENERATE_XLSX_EXPORT_ENTRYPOINT, {"created_by": "dev-user@example.test"}, "queued"),
        (BACKFILL_RULE_ENTRYPOINT, {"rule_id": 42}, "queued"),
    ]


def test_worker_drains_sync_abn_transaction_chain(migrated_postgres_url: str) -> None:
    job_id = enqueue_sync_abn_transactions(migrated_postgres_url)
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
        successful_entrypoints = connection.execute(
            """
            SELECT entrypoint
            FROM pgqueuer_log
            WHERE status = 'successful'
            ORDER BY id
            """
        ).fetchall()
        raw_count = connection.execute("SELECT count(*) FROM raw_transactions").fetchone()
        forecast_count = connection.execute("SELECT count(*) FROM monthly_forecasts").fetchone()

    assert job_status is None
    assert job_log_status == ("successful",)
    assert [row[0] for row in successful_entrypoints] == [
        SYNC_ABN_TRANSACTIONS_ENTRYPOINT,
        "normalize_transactions",
        "classify_transactions",
        "detect_recurring",
        "update_monthly_forecast",
    ]
    assert raw_count == (3,)
    assert forecast_count == (1,)
