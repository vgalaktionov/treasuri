from __future__ import annotations

from collections.abc import Iterator

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


def test_month_route_renders_forecast_drivers_and_category_pace(sample_app: Flask) -> None:
    response = sample_app.test_client().get("/month")

    assert response.status_code == 200
    assert b"May 2026" in response.data
    assert b"Safe to spend" in response.data
    assert b"EUR 558" in response.data
    assert b"Safe per day" in response.data
    assert b"EUR 93/day" in response.data
    assert b"Projected savings" in response.data
    assert b"EUR 1,558" in response.data
    assert b"Fixed costs" in response.data
    assert b"EUR 1,450 paid, EUR 620 upcoming" in response.data
    assert b"Income received" in response.data
    assert b"EUR 5,258 received" in response.data
    assert b"Uncategorized impact" in response.data
    assert b"1 transaction still needs review" in response.data
    assert b"Category pace" in response.data
    assert b"Groceries" in response.data
    assert b"EUR 64" in response.data
