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


def test_categories_route_renders_budget_averages(sample_app: Flask) -> None:
    response = sample_app.test_client().get("/categories")

    assert response.status_code == 200
    assert b"Categories" in response.data
    assert b"Groceries" in response.data
    assert b"EUR 64.35" in response.data
    assert b"Suggested" in response.data
    assert b"included in forecast" in response.data
    assert b"One-off / Large purchase" in response.data
    assert b"excluded from forecast" in response.data
