from __future__ import annotations

import re
from collections.abc import Iterator

import psycopg
import pytest
from testcontainers.postgres import PostgresContainer

from app.config import AppConfig
from app.migrate import run_migrations
from app.sample_data import load_sample_data
from app.web import create_app


@pytest.fixture(scope="module")
def sample_app() -> Iterator[object]:
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


def test_transactions_route_renders_sample_history(sample_app) -> None:
    response = sample_app.test_client().get("/transactions")

    assert response.status_code == 200
    assert b"Transactions" in response.data
    assert b"Sample Employer" in response.data
    assert b"Sample Supermarket" in response.data
    assert b"EUR 5,258.00" in response.data
    assert b"Preview rule" in response.data
    assert b"Raw data" in response.data


def test_review_route_only_renders_transactions_needing_review(sample_app) -> None:
    response = sample_app.test_client().get("/review")

    assert response.status_code == 200
    assert b"Review inbox" in response.data
    assert b"Unknown Sample Merchant" in response.data
    assert b"Sample Supermarket" not in response.data


def test_transactions_route_filters_by_search_and_category(sample_app) -> None:
    client = sample_app.test_client()

    search_response = client.get("/transactions?q=supermarket")
    category_response = client.get("/transactions?category=Dog")
    merchant_response = client.get("/transactions?merchant=Sample Pet Care")
    uncategorized_response = client.get("/transactions?kind=uncategorized")
    review_response = client.get("/transactions?needs_review=1")
    income_response = client.get("/transactions?kind=income")
    transfer_response = client.get("/transactions?kind=transfer")
    excluded_response = client.get("/transactions?kind=excluded")
    amount_response = client.get("/transactions?min_amount=300&max_amount=400")

    assert search_response.status_code == 200
    assert b"<h2>Sample Supermarket</h2>" in search_response.data
    assert b"<h2>Sample Employer</h2>" not in search_response.data
    assert category_response.status_code == 200
    assert b"<h2>Sample Pet Care</h2>" in category_response.data
    assert b"<h2>Sample Supermarket</h2>" not in category_response.data
    assert merchant_response.status_code == 200
    assert b"<h2>Sample Pet Care</h2>" in merchant_response.data
    assert b"<h2>Sample Supermarket</h2>" not in merchant_response.data
    assert uncategorized_response.status_code == 200
    assert b"<h2>Unknown Sample Merchant</h2>" in uncategorized_response.data
    assert b"<h2>Sample Supermarket</h2>" not in uncategorized_response.data
    assert review_response.status_code == 200
    assert b"<h2>Unknown Sample Merchant</h2>" in review_response.data
    assert b"<h2>Sample Supermarket</h2>" not in review_response.data
    assert income_response.status_code == 200
    assert b"<h2>Sample Employer</h2>" in income_response.data
    assert b"<h2>Sample Supermarket</h2>" not in income_response.data
    assert transfer_response.status_code == 200
    assert b"<h2>Sample Own Savings</h2>" in transfer_response.data
    assert b"<h2>Sample Employer</h2>" not in transfer_response.data
    assert excluded_response.status_code == 200
    assert b"<h2>Sample Furniture</h2>" in excluded_response.data
    assert b"<h2>Sample Supermarket</h2>" not in excluded_response.data
    assert amount_response.status_code == 200
    assert b"<h2>Sample Furniture</h2>" in amount_response.data
    assert b"<h2>Sample Own Savings</h2>" not in amount_response.data


def test_transactions_route_filters_by_month(sample_app) -> None:
    response = sample_app.test_client().get("/transactions?month=2026-04")

    assert response.status_code == 200
    assert b"No transactions to show." in response.data


def test_transactions_route_can_apply_manual_edit(sample_app) -> None:
    client = sample_app.test_client()
    transaction_id = _transaction_id(sample_app, "Large one-off sample purchase")
    response = client.get("/transactions?q=one-off")
    csrf_token = _extract_csrf(response.get_data(as_text=True))

    edit_response = client.post(
        f"/transactions/{transaction_id}/category",
        data={
            "csrf_token": csrf_token,
            "return_to": "/transactions?q=one-off",
            "category": "Shopping",
            "merchant": "Sample Edited Shop",
            "is_one_off": "1",
            "is_excluded_from_budget": "1",
        },
        follow_redirects=True,
    )

    with psycopg.connect(sample_app.config["DATABASE_URL"]) as connection:
        row = connection.execute(
            """
            SELECT
                categories.name,
                merchants.name,
                enriched_transactions.needs_review,
                enriched_transactions.classification_method,
                enriched_transactions.is_one_off,
                enriched_transactions.is_excluded_from_budget,
                manual_overrides.flags_json,
                manual_overrides.id IS NOT NULL
            FROM enriched_transactions
            JOIN categories ON categories.id = enriched_transactions.category_id
            LEFT JOIN merchants ON merchants.id = enriched_transactions.merchant_id
            LEFT JOIN manual_overrides
                ON manual_overrides.enriched_transaction_id = enriched_transactions.id
            WHERE enriched_transactions.id = %s
            """,
            (transaction_id,),
        ).fetchone()

    assert edit_response.status_code == 200
    assert b"Sample Edited Shop" in edit_response.data
    assert b"Shopping" in edit_response.data
    assert row == (
        "Shopping",
        "Sample Edited Shop",
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
    )


def test_transaction_raw_route_shows_source_payload(sample_app) -> None:
    transaction_id = _transaction_id(sample_app, "Groceries sample")

    response = sample_app.test_client().get(f"/transactions/{transaction_id}/raw")

    assert response.status_code == 200
    assert b"Raw transaction data" in response.data
    assert b"Sample Supermarket" in response.data
    assert b"Provider transaction ID" in response.data
    assert b"sample-groceries-2026-05" in response.data
    assert b"source" in response.data


def _transaction_id(app, description: str) -> int:
    with psycopg.connect(app.config["DATABASE_URL"]) as connection:
        row = connection.execute(
            """
            SELECT enriched_transactions.id
            FROM enriched_transactions
            JOIN raw_transactions ON raw_transactions.id = enriched_transactions.raw_transaction_id
            WHERE raw_transactions.description = %s
            """,
            (description,),
        ).fetchone()
    if row is None:
        raise AssertionError(f"transaction was not found: {description}")
    return int(row[0])


def _extract_csrf(html: str) -> str:
    match = re.search(r'name="csrf_token" value="([^"]+)"', html)
    if match is None:
        raise AssertionError("CSRF token was not rendered")
    return match.group(1)
