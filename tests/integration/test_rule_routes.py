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


def test_review_correction_can_preview_and_create_reusable_rule(sample_app: Flask) -> None:
    client = sample_app.test_client()
    review_html = client.get("/review").get_data(as_text=True)
    csrf_token = _extract_csrf(review_html)
    transaction_id = _review_transaction_id(sample_app)

    correction_response = client.post(
        f"/review/{transaction_id}/category",
        data={
            "csrf_token": csrf_token,
            "category": "Dog",
            "merchant": "Sample Pet Care",
            "next": "rule-preview",
        },
    )

    assert correction_response.status_code == 302
    assert correction_response.headers["Location"] == f"/rules/preview/from-transaction/{transaction_id}"

    preview_response = client.get(correction_response.headers["Location"])
    preview_html = preview_response.get_data(as_text=True)

    assert preview_response.status_code == 200
    assert "counterparty_name contains" in preview_html
    assert "Dog" in preview_html
    assert "Manual overrides skipped" in preview_html
    assert "<dd>1</dd>" in preview_html

    create_response = client.post(
        f"/rules/from-transaction/{transaction_id}",
        data={"csrf_token": csrf_token},
        follow_redirects=True,
    )

    with psycopg.connect(sample_app.config["DATABASE_URL"]) as connection:
        rows = connection.execute(
            """
            SELECT
                categorization_rules.field,
                categorization_rules.operator,
                categorization_rules.pattern,
                categories.name,
                merchants.name,
                categorization_rules.created_from_transaction_id
            FROM categorization_rules
            JOIN categories ON categories.id = categorization_rules.category_id
            LEFT JOIN merchants ON merchants.id = categorization_rules.merchant_id
            """
        ).fetchall()

    assert create_response.status_code == 200
    assert b"Rules" in create_response.data
    assert rows == [
        (
            "counterparty_name",
            "contains",
            "Unknown Sample Merchant",
            "Dog",
            "Sample Pet Care",
            transaction_id,
        )
    ]


def test_rule_backfill_applies_to_history_without_overwriting_manual_override(sample_app: Flask) -> None:
    client = sample_app.test_client()
    review_html = client.get("/review").get_data(as_text=True)
    csrf_token = _extract_csrf(review_html)
    transaction_id = _review_transaction_id(sample_app)
    historical_transaction_id = _insert_matching_historical_unknown(sample_app)

    client.post(
        f"/review/{transaction_id}/category",
        data={
            "csrf_token": csrf_token,
            "category": "Dog",
            "merchant": "Sample Pet Care",
            "next": "rule-preview",
        },
    )
    client.post(f"/rules/from-transaction/{transaction_id}", data={"csrf_token": csrf_token})

    rules_response = client.get("/rules")
    rules_html = rules_response.get_data(as_text=True)
    assert "Would change" in rules_html
    assert "<dd>1</dd>" in rules_html

    rule_id = _created_rule_id(sample_app)
    backfill_response = client.post(
        f"/rules/{rule_id}/backfill",
        data={"csrf_token": _extract_csrf(rules_html)},
        follow_redirects=True,
    )

    with psycopg.connect(sample_app.config["DATABASE_URL"]) as connection:
        rows = connection.execute(
            """
            SELECT
                enriched_transactions.id,
                categories.name,
                enriched_transactions.needs_review,
                enriched_transactions.classification_method,
                enriched_transactions.rule_id
            FROM enriched_transactions
            JOIN categories ON categories.id = enriched_transactions.category_id
            WHERE enriched_transactions.id IN (%s, %s)
            ORDER BY enriched_transactions.id
            """,
            (transaction_id, historical_transaction_id),
        ).fetchall()

    assert backfill_response.status_code == 200
    assert rows == [
        (transaction_id, "Dog", False, "manual_override", None),
        (historical_transaction_id, "Dog", False, "rule", rule_id),
    ]


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


def _created_rule_id(app: Flask) -> int:
    with psycopg.connect(app.config["DATABASE_URL"]) as connection:
        row = connection.execute("SELECT id FROM categorization_rules ORDER BY id DESC LIMIT 1").fetchone()
    if row is None:
        raise AssertionError("rule was not created")
    return int(row[0])


def _insert_matching_historical_unknown(app: Flask) -> int:
    with psycopg.connect(app.config["DATABASE_URL"]) as connection:
        with connection.transaction():
            account_row = connection.execute("SELECT id FROM accounts WHERE provider = 'fake' LIMIT 1").fetchone()
            if account_row is None:
                raise AssertionError("sample account was not found")
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
                VALUES (%s, 'fake', 'historical-review-match', 'historical-review-match', %s, %s, %s, 'EUR',
                    'Unknown Sample Merchant', 'Historical unknown sample', '{}'::jsonb)
                RETURNING id
                """,
                (int(account_row[0]), date(2026, 5, 10), date(2026, 5, 10), Decimal("-12.50")),
            ).fetchone()
            if raw_row is None:
                raise AssertionError("raw transaction insert did not return an id")
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
                    'Test historical rule match.'
                )
                RETURNING id
                """,
                (int(raw_row[0]),),
            ).fetchone()
    if enriched_row is None:
        raise AssertionError("enriched transaction insert did not return an id")
    return int(enriched_row[0])


def _extract_csrf(html: str) -> str:
    match = re.search(r'name="csrf_token" value="([^"]+)"', html)
    if match is None:
        raise AssertionError("CSRF token was not rendered")
    return match.group(1)
