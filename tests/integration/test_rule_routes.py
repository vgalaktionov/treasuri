from __future__ import annotations

import json
import re
from collections.abc import Iterator
from datetime import date
from decimal import Decimal

import psycopg
import pytest
from flask import Flask
from testcontainers.postgres import PostgresContainer

from app.config import AppConfig
from app.jobs.enqueue import BACKFILL_RULE_ENTRYPOINT
from app.jobs.worker import run_until_drained
from app.migrate import run_migrations
from app.rules import backfill_rule
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
        queued_job = connection.execute(
            """
            SELECT entrypoint, payload, status
            FROM pgqueuer
            ORDER BY id DESC
            LIMIT 1
            """
        ).fetchone()
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
    assert queued_job == (BACKFILL_RULE_ENTRYPOINT, json_bytes({"rule_id": rule_id}), "queued")
    assert rows == [
        (transaction_id, "Dog", False, "manual_override", None),
        (historical_transaction_id, "Unknown", True, "uncategorized", None),
    ]

    run_until_drained(sample_app.config["APP_CONFIG"])

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
        job_log = connection.execute(
            """
            SELECT status, entrypoint
            FROM pgqueuer_log
            WHERE status = 'successful'
            ORDER BY id
            """
        ).fetchall()

    assert rows == [
        (transaction_id, "Dog", False, "manual_override", None),
        (historical_transaction_id, "Dog", False, "rule", rule_id),
    ]
    assert job_log == [
        ("successful", BACKFILL_RULE_ENTRYPOINT),
        ("successful", "update_monthly_forecast"),
    ]


def test_rules_route_can_create_edit_and_disable_rule(sample_app: Flask) -> None:
    client = sample_app.test_client()
    rules_html = client.get("/rules").get_data(as_text=True)
    csrf_token = _extract_csrf(rules_html)

    create_response = client.post(
        "/rules",
        data={
            "csrf_token": csrf_token,
            "name": "Classify grocery text",
            "priority": "40",
            "is_active": "1",
            "field": "description",
            "operator": "contains",
            "pattern": "Groceries sample",
            "category": "Groceries",
            "merchant": "Sample Rule Merchant",
            "set_is_excluded_from_budget": "1",
        },
        follow_redirects=True,
    )
    rule_id = _created_rule_id(sample_app)

    edit_response = client.post(
        f"/rules/{rule_id}",
        data={
            "csrf_token": _extract_csrf(create_response.get_data(as_text=True)),
            "name": "Classify edited grocery text",
            "priority": "20",
            "is_active": "1",
            "field": "counterparty_name",
            "operator": "contains",
            "pattern": "Sample Supermarket",
            "category": "Eating out",
            "merchant": "",
            "set_is_transfer": "1",
        },
        follow_redirects=True,
    )
    disable_response = client.post(
        f"/rules/{rule_id}/active",
        data={
            "csrf_token": _extract_csrf(edit_response.get_data(as_text=True)),
            "is_active": "false",
        },
        follow_redirects=True,
    )

    with psycopg.connect(sample_app.config["DATABASE_URL"]) as connection:
        row = connection.execute(
            """
            SELECT
                categorization_rules.name,
                categorization_rules.priority,
                categorization_rules.is_active,
                categorization_rules.field,
                categorization_rules.operator,
                categorization_rules.pattern,
                categories.name,
                merchants.name,
                categorization_rules.set_is_income,
                categorization_rules.set_is_transfer,
                categorization_rules.set_is_savings,
                categorization_rules.set_is_fixed_cost,
                categorization_rules.set_is_excluded_from_budget
            FROM categorization_rules
            JOIN categories ON categories.id = categorization_rules.category_id
            LEFT JOIN merchants ON merchants.id = categorization_rules.merchant_id
            WHERE categorization_rules.id = %s
            """,
            (rule_id,),
        ).fetchone()

    assert create_response.status_code == 200
    assert b"Classify grocery text" in create_response.data
    assert b"excluded" in create_response.data
    assert edit_response.status_code == 200
    assert b"Classify edited grocery text" in edit_response.data
    assert b"transfer" in edit_response.data
    assert disable_response.status_code == 200
    assert b"inactive" in disable_response.data
    assert row == (
        "Classify edited grocery text",
        20,
        False,
        "counterparty_name",
        "contains",
        "Sample Supermarket",
        "Eating out",
        None,
        None,
        True,
        None,
        None,
        None,
    )


def test_rules_route_can_create_amount_between_rule(sample_app: Flask) -> None:
    client = sample_app.test_client()
    rules_html = client.get("/rules").get_data(as_text=True)
    csrf_token = _extract_csrf(rules_html)

    assert "amount_between" in rules_html
    assert 'value="amount"' in rules_html
    assert 'value="account_id"' in rules_html

    create_response = client.post(
        "/rules",
        data={
            "csrf_token": csrf_token,
            "name": "Classify mid-size variable spend",
            "priority": "30",
            "is_active": "1",
            "field": "amount",
            "operator": "amount_between",
            "pattern": "-100.00..-50.00",
            "category": "Groceries",
            "merchant": "",
            "set_is_fixed_cost": "1",
        },
        follow_redirects=True,
    )

    with psycopg.connect(sample_app.config["DATABASE_URL"]) as connection:
        row = connection.execute(
            """
            SELECT
                categorization_rules.id,
                categorization_rules.field,
                categorization_rules.operator,
                categorization_rules.pattern,
                categories.name,
                categorization_rules.set_is_fixed_cost
            FROM categorization_rules
            JOIN categories ON categories.id = categorization_rules.category_id
            WHERE categorization_rules.name = 'Classify mid-size variable spend'
            """
        ).fetchone()

    body = create_response.get_data(as_text=True)
    assert create_response.status_code == 200
    assert row is not None
    assert row[1:] == ("amount", "amount_between", "-100.00..-50.00", "Groceries", True)
    assert "amount amount_between" in body
    assert "fixed" in body
    assert "Matches</dt>\n                <dd>2</dd>" in body

    result = backfill_rule(sample_app.config["DATABASE_URL"], int(row[0]))

    with psycopg.connect(sample_app.config["DATABASE_URL"]) as connection:
        fixed_count = connection.execute(
            """
            SELECT count(*)
            FROM enriched_transactions
            JOIN raw_transactions ON raw_transactions.id = enriched_transactions.raw_transaction_id
            WHERE enriched_transactions.rule_id = %s
                AND enriched_transactions.is_fixed_cost = true
                AND abs(raw_transactions.amount) BETWEEN 50 AND 100
            """,
            (int(row[0]),),
        ).fetchone()

    assert result.updated_count == 2
    assert fixed_count == (2,)


def test_rules_route_rejects_invalid_amount_between_rule(sample_app: Flask) -> None:
    client = sample_app.test_client()
    csrf_token = _extract_csrf(client.get("/rules").get_data(as_text=True))

    response = client.post(
        "/rules",
        data={
            "csrf_token": csrf_token,
            "name": "Broken amount rule",
            "priority": "30",
            "is_active": "1",
            "field": "description",
            "operator": "amount_between",
            "pattern": "-100.00..-50.00",
            "category": "Groceries",
            "merchant": "",
        },
    )

    assert response.status_code == 400


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


def json_bytes(value: dict[str, object]) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":")).encode()
