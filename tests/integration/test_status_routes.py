from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager

import psycopg
from flask import Flask
from testcontainers.postgres import PostgresContainer

from app.config import AppConfig
from app.exports.xlsx import generate_budget_export
from app.jobs.enqueue import enqueue_sync_now
from app.migrate import run_migrations
from app.sample_data import load_sample_data
from app.web import create_app


def test_status_route_shows_runtime_state_without_secrets() -> None:
    with _sample_app() as sample_app:
        enqueue_sync_now(sample_app.config["DATABASE_URL"])
        generate_budget_export(sample_app.config["DATABASE_URL"], created_by="dev-user@example.test")
        with psycopg.connect(sample_app.config["DATABASE_URL"]) as connection:
            connection.execute(
                """
                INSERT INTO pgqueuer_log (job_id, status, priority, entrypoint)
                VALUES (1, 'successful', 0, 'sync-now')
                """
            )

        response = sample_app.test_client().get("/status")
        body = response.get_data(as_text=True)

    assert response.status_code == 200
    assert "App version" in body
    assert "0.1.test" in body
    assert "Git SHA" in body
    assert "abcdef123456" in body
    assert "OIDC realm" in body
    assert "treasuri-test" in body
    assert "Worker concurrency" in body
    assert "3" in body
    assert "Sync lookback default" in body
    assert "45 days" in body
    assert "Export retention" in body
    assert "30 days" in body
    assert "Migration version" in body
    assert "0004_classification_runtime" in body
    assert "Last sync" in body
    assert "completed" in body
    assert "fake, 7 new, 0 updated, lookback 90 days, 2 skipped old" in body
    assert "Known transactions" in body
    assert "7 total" in body
    assert "Classified transactions" in body
    assert "6" in body
    assert "Needs review" in body
    assert "1" in body
    assert "Classification methods" in body
    assert "sample 6, uncategorized 1" in body
    assert "Last forecast update" in body
    assert "safe to spend 558.00" in body
    assert "Queued jobs" in body
    assert "queued 1" in body
    assert "Latest worker result" in body
    assert "sync-now" in body
    assert "Latest export" in body
    assert "budget-averages-2026-05.xlsx" in body

    assert "super-secret" not in body
    assert "client-secret.json" not in body
    assert "card-secret" not in body
    assert "soft-token-secret" not in body
    assert "llama-secret" not in body
    assert "token=secret" not in body


def test_status_route_handles_missing_database() -> None:
    app = create_app(
        AppConfig(
            app_env="test",
            secret_key="test-secret",
            allowed_emails=("dev-user@example.test",),
            oidc_enabled=False,
            oidc_testing_profile={"sub": "dev-user", "email": "dev-user@example.test"},
            oidc_cookie_secure=False,
        ),
        {"TESTING": True},
    )

    response = app.test_client().get("/status")
    body = response.get_data(as_text=True)

    assert response.status_code == 200
    assert "Connection" in body
    assert "not configured" in body
    assert "App version" in body
    assert "Git SHA" in body
    assert "unavailable" in body


@contextmanager
def _sample_app() -> Iterator[Flask]:
    with PostgresContainer(
        image="postgres:16-alpine",
        username="treasuri",
        password="treasuri",
        dbname="treasuri",
        driver=None,
    ) as postgres:
        database_url = postgres.get_connection_url(driver=None)
        run_migrations(database_url)
        load_sample_data(database_url)
        yield create_app(
            AppConfig(
                app_env="test",
                app_version="0.1.test",
                git_sha="abcdef1234567890",
                secret_key="super-secret",
                database_url=database_url,
                allowed_emails=("dev-user@example.test",),
                oidc_enabled=False,
                oidc_client_secrets="client-secret.json",
                oidc_openid_realm="treasuri-test",
                oidc_testing_profile={"sub": "dev-user", "email": "dev-user@example.test"},
                oidc_cookie_secure=False,
                worker_concurrency=3,
                sync_lookback_days=45,
                export_retention_days=30,
                llm_enabled=True,
                llm_base_url="http://llama-secret:password@llama:8080/v1?token=secret",
                bank_provider="abn",
                abn_account_iban="NL00ABNA0000000000",
                abn_card_number="card-secret",
                abn_soft_token="soft-token-secret",
            ),
            {"TESTING": True},
        )
