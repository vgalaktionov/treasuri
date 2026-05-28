from __future__ import annotations

import re
from collections.abc import Iterator
from datetime import date
from decimal import Decimal

import psycopg
import pytest
from flask import Flask
from testcontainers.postgres import PostgresContainer

from app.config import AppConfig
from app.migrate import run_migrations
from app.recurring import detect_recurring
from app.sample_data import SAMPLE_FORECAST_DATE, load_sample_data
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
        _insert_streaming_transactions(database_url)
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


def test_detect_recurring_creates_series_and_links_transactions(sample_app: Flask) -> None:
    result = detect_recurring(sample_app.config["DATABASE_URL"])

    with psycopg.connect(sample_app.config["DATABASE_URL"]) as connection:
        series_rows = connection.execute(
            """
            SELECT name, cadence, amount_mode, expected_amount, expected_day_of_month, next_expected_date
            FROM recurring_series
            """
        ).fetchall()
        linked_count = connection.execute(
            """
            SELECT count(*)
            FROM enriched_transactions
            WHERE is_recurring = true
                AND recurring_series_id IS NOT NULL
            """
        ).fetchone()

    assert result.detected_count == 1
    assert result.linked_transaction_count == 3
    assert series_rows == [("Sample Streaming", "monthly", "fixed", Decimal("12.99"), 5, date(2026, 6, 5))]
    assert linked_count == (3,)


def test_recurring_route_renders_detected_series(sample_app: Flask) -> None:
    detect_recurring(sample_app.config["DATABASE_URL"])

    response = sample_app.test_client().get("/recurring")

    assert response.status_code == 200
    assert b"Sample Streaming" in response.data
    assert b"EUR 12.99" in response.data
    assert b"05 Jun 2026" in response.data
    assert b"Confirm" in response.data
    assert b"Disable" in response.data


def test_confirm_recurring_route_adds_upcoming_commitment_to_forecast(sample_app: Flask) -> None:
    client = sample_app.test_client()
    page = client.get("/recurring")
    csrf_token = _extract_csrf(page.get_data(as_text=True))
    series_id = _sample_streaming_series_id(sample_app.config["DATABASE_URL"])

    response = client.post(
        f"/recurring/{series_id}/confirm",
        data={"csrf_token": csrf_token},
        follow_redirects=True,
    )

    with psycopg.connect(sample_app.config["DATABASE_URL"]) as connection:
        row = connection.execute(
            """
            SELECT
                recurring_series.is_confirmed,
                monthly_forecasts.fixed_costs_upcoming,
                monthly_forecasts.safe_to_spend
            FROM recurring_series
            CROSS JOIN monthly_forecasts
            WHERE recurring_series.id = %s AND monthly_forecasts.year_month = '2026-05'
            """,
            (series_id,),
        ).fetchone()

    assert response.status_code == 200
    assert b"confirmed" in response.data
    assert row == (True, Decimal("632.99"), Decimal("545.01"))


def test_disable_recurring_route_removes_confirmed_commitment_from_forecast(sample_app: Flask) -> None:
    client = sample_app.test_client()
    page = client.get("/recurring")
    csrf_token = _extract_csrf(page.get_data(as_text=True))
    series_id = _sample_streaming_series_id(sample_app.config["DATABASE_URL"])
    client.post(f"/recurring/{series_id}/confirm", data={"csrf_token": csrf_token})

    page = client.get("/recurring")
    csrf_token = _extract_csrf(page.get_data(as_text=True))
    response = client.post(
        f"/recurring/{series_id}/disable",
        data={"csrf_token": csrf_token},
        follow_redirects=True,
    )

    with psycopg.connect(sample_app.config["DATABASE_URL"]) as connection:
        row = connection.execute(
            """
            SELECT
                recurring_series.is_active,
                monthly_forecasts.fixed_costs_upcoming,
                monthly_forecasts.safe_to_spend
            FROM recurring_series
            CROSS JOIN monthly_forecasts
            WHERE recurring_series.id = %s AND monthly_forecasts.year_month = '2026-05'
            """,
            (series_id,),
        ).fetchone()

    assert response.status_code == 200
    assert b"Sample Streaming" not in response.data
    assert row == (False, Decimal("620.00"), Decimal("558.00"))


def test_recurring_actions_require_csrf(sample_app: Flask) -> None:
    series_id = _sample_streaming_series_id(sample_app.config["DATABASE_URL"])

    response = sample_app.test_client().post(f"/recurring/{series_id}/confirm")

    assert response.status_code == 400
    assert b"Invalid CSRF token" in response.data


def _insert_streaming_transactions(database_url: str) -> None:
    with psycopg.connect(database_url) as connection:
        with connection.transaction():
            account_id = connection.execute("SELECT id FROM accounts WHERE provider = 'fake' LIMIT 1").fetchone()
            if account_id is None:
                raise AssertionError("sample account was not inserted")
            merchant_id = connection.execute(
                """
                INSERT INTO merchants (name, normalized_name, default_category_id)
                VALUES (
                    'Sample Streaming',
                    'sample streaming',
                    (SELECT id FROM categories WHERE name = 'Subscriptions')
                )
                ON CONFLICT (normalized_name)
                DO UPDATE SET default_category_id = EXCLUDED.default_category_id
                RETURNING id
                """
            ).fetchone()
            if merchant_id is None:
                raise AssertionError("streaming merchant was not inserted")

            for booking_date in (date(2026, 3, 5), date(2026, 4, 5), date(2026, 5, 5)):
                raw_id = connection.execute(
                    """
                    INSERT INTO raw_transactions (
                        account_id,
                        provider,
                        provider_transaction_id,
                        source_hash,
                        booking_date,
                        value_date,
                        amount,
                        currency,
                        counterparty_name,
                        description,
                        raw_payload_json
                    )
                    VALUES (
                        %s,
                        'fake',
                        %s,
                        %s,
                        %s,
                        %s,
                        -12.99,
                        'EUR',
                        'Sample Streaming',
                        'Streaming sample',
                        '{}'::jsonb
                    )
                    RETURNING id
                    """,
                    (
                        account_id[0],
                        f"streaming-{booking_date.isoformat()}",
                        f"streaming-{booking_date.isoformat()}",
                        booking_date,
                        booking_date,
                    ),
                ).fetchone()
                if raw_id is None:
                    raise AssertionError("raw streaming transaction was not inserted")
                connection.execute(
                    """
                    INSERT INTO enriched_transactions (
                        raw_transaction_id,
                        merchant_id,
                        category_id,
                        is_fixed_cost,
                        is_variable_cost,
                        needs_review,
                        classification_method,
                        classification_confidence,
                        classification_reason
                    )
                    VALUES (
                        %s,
                        %s,
                        (SELECT id FROM categories WHERE name = 'Subscriptions'),
                        true,
                        false,
                        false,
                        'sample',
                        1,
                        'Recurring test sample.'
                    )
                    """,
                    (raw_id[0], merchant_id[0]),
                )


def _sample_streaming_series_id(database_url: str) -> int:
    with psycopg.connect(database_url) as connection:
        row = connection.execute(
            "SELECT id FROM recurring_series WHERE name = 'Sample Streaming' AND is_active = true ORDER BY id LIMIT 1"
        ).fetchone()
    if row is None:
        raise AssertionError("Sample Streaming recurring series was not inserted")
    if not isinstance(row[0], int):
        raise AssertionError("recurring series id was not an integer")
    return row[0]


def _extract_csrf(html: str) -> str:
    match = re.search(r'name="csrf_token" value="([^"]+)"', html)
    if match is None:
        raise AssertionError("CSRF token was not rendered")
    return match.group(1)
