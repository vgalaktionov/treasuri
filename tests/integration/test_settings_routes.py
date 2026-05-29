from __future__ import annotations

import re
from collections.abc import Iterator
from decimal import Decimal

import psycopg
import pytest
from flask import Flask
from testcontainers.postgres import PostgresContainer

from app.config import AppConfig
from app.migrate import run_migrations
from app.sample_data import SAMPLE_FORECAST_DATE, load_sample_data
from app.settings import load_forecast_settings
from app.web import create_app


@pytest.fixture
def sample_app() -> Iterator[Flask]:
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
                secret_key="test-secret",
                database_url=database_url,
                allowed_emails=("dev-user@example.test",),
                oidc_enabled=False,
                oidc_testing_profile={
                    "sub": "dev-user",
                    "email": "dev-user@example.test",
                },
                oidc_cookie_secure=False,
                llm_enabled=False,
            ),
            {"TESTING": True, "FORECAST_AS_OF": SAMPLE_FORECAST_DATE},
        )


def test_settings_update_persists_assumptions_and_recalculates_dashboard(sample_app: Flask) -> None:
    client = sample_app.test_client()
    settings_response = client.get("/settings")
    csrf_token = _extract_csrf(settings_response.get_data(as_text=True))

    response = client.post(
        "/settings",
        data={
            "csrf_token": csrf_token,
            "current_liquid_balance": "3215.77",
            "target_monthly_savings": "900.00",
            "safety_buffer": "1000.00",
            "salary_day": "25",
            "baseline_months": "12",
            "sync_lookback_days": "120",
            "fixed_costs_upcoming": "620.00",
            "variable_baseline_3m": "0.00",
            "variable_baseline_6m": "0.00",
            "llm_enabled": "true",
            "llm_confidence_threshold": "0.75",
        },
        follow_redirects=True,
    )

    with psycopg.connect(sample_app.config["DATABASE_URL"]) as connection:
        target_setting = connection.execute(
            "SELECT value_json FROM app_settings WHERE key = 'target_monthly_savings'"
        ).fetchone()
        forecast_row = connection.execute(
            "SELECT target_savings, safe_to_spend FROM monthly_forecasts WHERE year_month = '2026-05'"
        ).fetchone()
        llm_settings = connection.execute(
            """
            SELECT key, value_json
            FROM app_settings
            WHERE key IN ('llm_enabled', 'llm_confidence_threshold')
            ORDER BY key
            """
        ).fetchall()
        operating_settings = connection.execute(
            """
            SELECT key, value_json
            FROM app_settings
            WHERE key IN ('salary_day', 'baseline_months', 'sync_lookback_days')
            ORDER BY key
            """
        ).fetchall()

    assert response.status_code == 200
    assert target_setting == ("900.00",)
    assert forecast_row == (Decimal("900.00"), Decimal("658.00"))
    assert llm_settings == [("llm_confidence_threshold", "0.75"), ("llm_enabled", True)]
    assert operating_settings == [("baseline_months", 12), ("salary_day", 25), ("sync_lookback_days", 120)]
    assert b"EUR 658" in response.data


def test_settings_route_renders_operating_and_llm_controls(sample_app: Flask) -> None:
    response = sample_app.test_client().get("/settings")

    assert response.status_code == 200
    assert b"Salary day" in response.data
    assert b'name="baseline_months"' in response.data
    assert b'name="sync_lookback_days"' in response.data
    assert b"Accounts" in response.data
    assert b"Sample current account" in response.data
    assert b"Category taxonomy" in response.data
    assert b"22 categories" in response.data
    assert b"Sync schedule" in response.data
    assert b"90 days" in response.data
    assert b"fake completed" in response.data
    assert b"LLM fallback" in response.data
    assert b'name="llm_confidence_threshold"' in response.data


def test_forecast_settings_use_configured_sync_lookback_default() -> None:
    with PostgresContainer(
        image="postgres:16-alpine",
        username="treasuri",
        password="treasuri",
        dbname="treasuri",
        driver=None,
    ) as postgres:
        database_url = postgres.get_connection_url(driver=None)
        run_migrations(database_url)

        settings = load_forecast_settings(
            database_url,
            AppConfig(
                app_env="test",
                secret_key="test-secret",
                database_url=database_url,
                allowed_emails=("dev-user@example.test",),
                oidc_enabled=False,
                oidc_testing_profile={"sub": "dev-user", "email": "dev-user@example.test"},
                oidc_cookie_secure=False,
                sync_lookback_days=45,
                llm_enabled=False,
            ),
        )

    assert settings.sync_lookback_days == 45


def test_settings_update_requires_csrf(sample_app: Flask) -> None:
    response = sample_app.test_client().post(
        "/settings",
        data={
            "current_liquid_balance": "3215.77",
            "target_monthly_savings": "900.00",
            "safety_buffer": "1000.00",
            "fixed_costs_upcoming": "620.00",
            "variable_baseline_3m": "0.00",
            "variable_baseline_6m": "0.00",
        },
    )

    assert response.status_code == 400
    assert b"Invalid CSRF token" in response.data


def _extract_csrf(html: str) -> str:
    match = re.search(r'name="csrf_token" value="([^"]+)"', html)
    if match is None:
        raise AssertionError("CSRF token was not rendered")
    return match.group(1)
