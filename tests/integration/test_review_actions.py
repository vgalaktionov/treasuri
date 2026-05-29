from __future__ import annotations

import re
from collections.abc import Iterator

import psycopg
import pytest
from flask import Flask
from testcontainers.postgres import PostgresContainer

from app.config import AppConfig
from app.migrate import run_migrations
from app.sample_data import load_sample_data
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
            {"TESTING": True},
        )


def test_review_category_update_requires_csrf(sample_app: Flask) -> None:
    response = sample_app.test_client().post(
        _review_action(sample_app),
        data={"category": "Dog", "merchant": "Sample Pet Care"},
    )

    assert response.status_code == 400
    assert b"Invalid CSRF token" in response.data


def test_review_category_update_creates_manual_override_and_clears_review(sample_app: Flask) -> None:
    client = sample_app.test_client()
    review_response = client.get("/review")
    csrf_token = _extract_csrf(review_response.get_data(as_text=True))

    response = client.post(
        _review_action(sample_app),
        data={
            "csrf_token": csrf_token,
            "category": "Dog",
            "merchant": "Sample Pet Care",
            "create_alias": "1",
            "is_one_off": "1",
            "is_excluded_from_budget": "1",
        },
        follow_redirects=True,
    )

    with psycopg.connect(sample_app.config["DATABASE_URL"]) as connection:
        rows = connection.execute(
            """
            SELECT
                categories.name,
                merchants.name,
                enriched_transactions.needs_review,
                enriched_transactions.classification_method,
                enriched_transactions.is_one_off,
                enriched_transactions.is_excluded_from_budget,
                manual_overrides.flags_json,
                manual_overrides.id IS NOT NULL,
                merchant_aliases.match_text,
                merchant_aliases.match_type
            FROM enriched_transactions
            JOIN categories ON categories.id = enriched_transactions.category_id
            LEFT JOIN merchants ON merchants.id = enriched_transactions.merchant_id
            LEFT JOIN manual_overrides
                ON manual_overrides.enriched_transaction_id = enriched_transactions.id
            LEFT JOIN merchant_aliases ON merchant_aliases.merchant_id = merchants.id
            WHERE enriched_transactions.id = %s
            """,
            (_review_transaction_id(sample_app),),
        ).fetchall()

    assert response.status_code == 200
    assert b"Unknown Sample Merchant" not in response.data
    assert rows == [
        (
            "Dog",
            "Sample Pet Care",
            False,
            "manual_override",
            True,
            True,
            {
                "is_one_off": True,
                "is_savings": False,
                "is_transfer": False,
                "is_excluded_from_budget": True,
            },
            True,
            "Unknown Sample Merchant",
            "contains",
        )
    ]


def test_review_category_update_can_skip_merchant_alias(sample_app: Flask) -> None:
    client = sample_app.test_client()
    review_response = client.get("/review")
    csrf_token = _extract_csrf(review_response.get_data(as_text=True))

    response = client.post(
        _review_action(sample_app),
        data={
            "csrf_token": csrf_token,
            "category": "Dog",
            "merchant": "Sample Pet Care",
        },
        follow_redirects=True,
    )

    with psycopg.connect(sample_app.config["DATABASE_URL"]) as connection:
        alias_count = connection.execute("SELECT count(*) FROM merchant_aliases").fetchone()
    if alias_count is None:
        raise AssertionError("alias count was not returned")

    assert response.status_code == 200
    assert alias_count[0] == 0


def test_review_category_update_refreshes_current_month_forecast(sample_app: Flask) -> None:
    client = sample_app.test_client()
    _set_forecast_updated_at(sample_app, "2026-05-01 00:00:00+00")
    review_response = client.get("/review")
    csrf_token = _extract_csrf(review_response.get_data(as_text=True))

    response = client.post(
        _review_action(sample_app),
        data={
            "csrf_token": csrf_token,
            "category": "Dog",
            "merchant": "Sample Pet Care",
        },
        follow_redirects=True,
    )

    with psycopg.connect(sample_app.config["DATABASE_URL"]) as connection:
        row = connection.execute(
            """
            SELECT updated_at, explanation_json
            FROM monthly_forecasts
            WHERE year_month = '2026-05'
            """
        ).fetchone()

    assert response.status_code == 200
    assert row is not None
    assert str(row[0]) > "2026-05-01"
    assert "review_burden" not in row[1]["confidence_reasons"]


def test_review_category_update_can_apply_to_similar_transactions(sample_app: Flask) -> None:
    similar_id = _insert_similar_review_transaction(sample_app)
    client = sample_app.test_client()
    review_response = client.get("/review")
    csrf_token = _extract_csrf(review_response.get_data(as_text=True))

    response = client.post(
        _review_action(sample_app),
        data={
            "csrf_token": csrf_token,
            "category": "Dog",
            "merchant": "Sample Pet Care",
            "next": "apply-similar",
        },
        follow_redirects=True,
    )

    with psycopg.connect(sample_app.config["DATABASE_URL"]) as connection:
        rows = connection.execute(
            """
            SELECT
                enriched_transactions.id,
                categories.name,
                merchants.name,
                enriched_transactions.needs_review,
                enriched_transactions.classification_method,
                manual_overrides.id IS NOT NULL
            FROM enriched_transactions
            JOIN categories ON categories.id = enriched_transactions.category_id
            LEFT JOIN merchants ON merchants.id = enriched_transactions.merchant_id
            LEFT JOIN manual_overrides
                ON manual_overrides.enriched_transaction_id = enriched_transactions.id
            WHERE enriched_transactions.id IN (%s, %s)
            ORDER BY enriched_transactions.id
            """,
            (_review_transaction_id(sample_app), similar_id),
        ).fetchall()

    assert response.status_code == 200
    assert b"Unknown Sample Merchant" not in response.data
    assert rows == [
        (_review_transaction_id(sample_app), "Dog", "Sample Pet Care", False, "manual_override", True),
        (similar_id, "Dog", "Sample Pet Care", False, "manual_override", True),
    ]


def _review_action(app: Flask) -> str:
    return f"/review/{_review_transaction_id(app)}/category"


def _review_transaction_id(app: Flask) -> int:
    with psycopg.connect(app.config["DATABASE_URL"]) as connection:
        row = connection.execute(
            """
            SELECT enriched_transactions.id
            FROM enriched_transactions
            JOIN raw_transactions ON raw_transactions.id = enriched_transactions.raw_transaction_id
            WHERE raw_transactions.description = 'Needs review sample'
            """
        ).fetchone()
    if row is None:
        raise AssertionError("review transaction was not found")
    return int(row[0])


def _insert_similar_review_transaction(app: Flask) -> int:
    with psycopg.connect(app.config["DATABASE_URL"]) as connection:
        with connection.transaction():
            raw_row = connection.execute(
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
                SELECT
                    accounts.id,
                    'fake',
                    'similar-review-2026-05',
                    'similar-review-2026-05',
                    '2026-05-22',
                    '2026-05-22',
                    -35.00,
                    'EUR',
                    'Unknown Sample Merchant',
                    'Similar needs review sample',
                    '{"source":"test"}'::jsonb
                FROM accounts
                WHERE accounts.provider = 'fake'
                LIMIT 1
                RETURNING id
                """
            ).fetchone()
            if raw_row is None:
                raise AssertionError("similar raw transaction was not inserted")
            enriched_row = connection.execute(
                """
                INSERT INTO enriched_transactions (
                    raw_transaction_id,
                    category_id,
                    needs_review,
                    classification_method,
                    classification_confidence,
                    classification_reason
                )
                VALUES (
                    %s,
                    (SELECT id FROM categories WHERE name = 'Unknown'),
                    true,
                    'uncategorized',
                    0,
                    'Similar test transaction.'
                )
                RETURNING id
                """,
                (raw_row[0],),
            ).fetchone()
            if enriched_row is None:
                raise AssertionError("similar enriched transaction was not inserted")
            return int(enriched_row[0])


def _set_forecast_updated_at(app: Flask, updated_at: str) -> None:
    with psycopg.connect(app.config["DATABASE_URL"]) as connection:
        with connection.transaction():
            connection.execute(
                "UPDATE monthly_forecasts SET updated_at = %s WHERE year_month = '2026-05'",
                (updated_at,),
            )


def _extract_csrf(html: str) -> str:
    match = re.search(r'name="csrf_token" value="([^"]+)"', html)
    if match is None:
        raise AssertionError("CSRF token was not rendered")
    return match.group(1)
