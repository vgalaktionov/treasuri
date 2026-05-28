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


def _extract_csrf(html: str) -> str:
    match = re.search(r'name="csrf_token" value="([^"]+)"', html)
    if match is None:
        raise AssertionError("CSRF token was not rendered")
    return match.group(1)
