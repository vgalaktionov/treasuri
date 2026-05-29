from __future__ import annotations

import json
from collections.abc import Iterator

import psycopg
import pytest
from testcontainers.postgres import PostgresContainer

from app.config import AppConfig
from app.jobs.enqueue import (
    BACKFILL_RULE_ENTRYPOINT,
    CLASSIFY_TRANSACTIONS_ENTRYPOINT,
    GENERATE_XLSX_EXPORT_ENTRYPOINT,
    REQUIRED_JOB_ENTRYPOINTS,
    SYNC_ABN_TRANSACTIONS_ENTRYPOINT,
    SYNC_NOW_ENTRYPOINT,
    UPDATE_MONTHLY_FORECAST_ENTRYPOINT,
    enqueue_backfill_rule,
    enqueue_generate_xlsx_export,
    enqueue_sync_abn_transactions,
    enqueue_sync_now,
)
from app.jobs.worker import run_until_drained
from app.migrate import run_migrations
from app.sample_data import load_sample_data


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


def test_worker_drains_sync_abn_transaction_chain(
    migrated_postgres_url: str, capsys: pytest.CaptureFixture[str]
) -> None:
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
    logs = _json_logs(capsys.readouterr().out)

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
    assert _find_log(logs, "job_started", SYNC_ABN_TRANSACTIONS_ENTRYPOINT) is not None
    sync_log = _find_log(logs, "job_completed", SYNC_ABN_TRANSACTIONS_ENTRYPOINT)
    assert sync_log is not None
    assert sync_log["new_transaction_count"] == 3
    classify_log = _find_log(logs, "job_completed", CLASSIFY_TRANSACTIONS_ENTRYPOINT)
    assert classify_log is not None
    assert classify_log["classified_count"] == 3
    assert isinstance(classify_log["method_counts"], dict)
    forecast_log = _find_log(logs, "forecast_recalculated", UPDATE_MONTHLY_FORECAST_ENTRYPOINT)
    assert forecast_log is not None
    assert forecast_log["year_month"] == "2026-05"


def test_worker_refreshes_forecast_when_sync_has_only_seen_transactions(
    migrated_postgres_url: str, capsys: pytest.CaptureFixture[str]
) -> None:
    config = AppConfig(
        app_env="test",
        secret_key="test-secret",
        database_url=migrated_postgres_url,
        oidc_enabled=False,
        llm_enabled=False,
        bank_provider="fake",
    )
    enqueue_sync_abn_transactions(migrated_postgres_url)
    run_until_drained(config)
    capsys.readouterr()
    _set_forecast_updated_at(migrated_postgres_url, "2026-05-01 00:00:00+00")

    enqueue_sync_abn_transactions(migrated_postgres_url)
    run_until_drained(config)
    logs = _json_logs(capsys.readouterr().out)

    with psycopg.connect(migrated_postgres_url) as connection:
        forecast_row = connection.execute(
            """
            SELECT updated_at
            FROM monthly_forecasts
            WHERE year_month = '2026-05'
            """
        ).fetchone()

    sync_log = _find_log(logs, "job_completed", SYNC_ABN_TRANSACTIONS_ENTRYPOINT)
    assert sync_log is not None
    assert sync_log["new_transaction_count"] == 0
    assert sync_log["updated_transaction_count"] == 3
    normalize_log = _find_log(logs, "job_completed", "normalize_transactions")
    assert normalize_log is not None
    assert normalize_log["created_count"] == 0
    forecast_log = _find_log(logs, "forecast_recalculated", UPDATE_MONTHLY_FORECAST_ENTRYPOINT)
    assert forecast_log is not None
    assert forecast_log["year_month"] == "2026-05"
    assert forecast_row is not None
    assert str(forecast_row[0]) > "2026-05-01"


def test_worker_drains_generate_xlsx_export_job(migrated_postgres_url: str, capsys: pytest.CaptureFixture[str]) -> None:
    load_sample_data(migrated_postgres_url)
    job_id = enqueue_generate_xlsx_export(migrated_postgres_url, created_by="dev-user@example.test")
    config = AppConfig(
        app_env="test",
        secret_key="test-secret",
        database_url=migrated_postgres_url,
        oidc_enabled=False,
        llm_enabled=False,
        bank_provider="fake",
    )

    run_until_drained(config)
    logs = _json_logs(capsys.readouterr().out)

    with psycopg.connect(migrated_postgres_url) as connection:
        job_status = connection.execute("SELECT status FROM pgqueuer WHERE id = %s", (job_id,)).fetchone()
        job_log_status = connection.execute(
            "SELECT status FROM pgqueuer_log WHERE job_id = %s ORDER BY created DESC LIMIT 1",
            (job_id,),
        ).fetchone()
        row = connection.execute(
            """
            SELECT
                export_runs.id,
                export_runs.status,
                export_runs.created_by,
                export_files.filename,
                export_files.size_bytes,
                export_files.content IS NOT NULL
            FROM export_runs
            JOIN export_files ON export_files.export_run_id = export_runs.id
            """
        ).fetchone()

    assert job_status is None
    assert job_log_status == ("successful",)
    assert row is not None
    assert row[1:4] == ("completed", "dev-user@example.test", "budget-averages-2026-05.xlsx")
    assert row[4] > 0
    assert row[5] is True
    assert _find_log(logs, "job_started", GENERATE_XLSX_EXPORT_ENTRYPOINT) is not None
    completed_log = _find_log(logs, "job_completed", GENERATE_XLSX_EXPORT_ENTRYPOINT)
    assert completed_log is not None
    assert completed_log["export_run_id"] == row[0]
    export_log = _find_log(logs, "export_generated", GENERATE_XLSX_EXPORT_ENTRYPOINT)
    assert export_log is not None
    assert export_log["export_run_id"] == completed_log["export_run_id"]


def _json_logs(output: str) -> list[dict[str, object]]:
    return [json.loads(line) for line in output.splitlines() if line.strip()]


def _find_log(logs: list[dict[str, object]], event: str, entrypoint: str) -> dict[str, object] | None:
    for log in logs:
        if log.get("event") == event and log.get("entrypoint") == entrypoint:
            return log
    return None


def _set_forecast_updated_at(database_url: str, updated_at: str) -> None:
    with psycopg.connect(database_url) as connection:
        with connection.transaction():
            connection.execute(
                "UPDATE monthly_forecasts SET updated_at = %s WHERE year_month = '2026-05'",
                (updated_at,),
            )
