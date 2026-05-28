from __future__ import annotations

from collections.abc import Iterator

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
    review_response = client.get("/transactions?needs_review=1")

    assert search_response.status_code == 200
    assert b"Sample Supermarket" in search_response.data
    assert b"Sample Employer" not in search_response.data
    assert category_response.status_code == 200
    assert b"Sample Pet Care" in category_response.data
    assert b"Sample Supermarket" not in category_response.data
    assert review_response.status_code == 200
    assert b"Unknown Sample Merchant" in review_response.data
    assert b"Sample Supermarket" not in review_response.data


def test_transactions_route_filters_by_month(sample_app) -> None:
    response = sample_app.test_client().get("/transactions?month=2026-04")

    assert response.status_code == 200
    assert b"No transactions to show." in response.data
