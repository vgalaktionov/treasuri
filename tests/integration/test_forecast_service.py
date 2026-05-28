from __future__ import annotations

from collections.abc import Iterator
from datetime import date
from decimal import Decimal

import psycopg
import pytest
from testcontainers.postgres import PostgresContainer

from app.forecast.service import update_monthly_forecast
from app.migrate import run_migrations
from app.sample_data import load_sample_data


@pytest.fixture
def sample_database_url() -> Iterator[str]:
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
        yield database_url


def test_update_monthly_forecast_recomputes_snapshot_from_transactions(sample_database_url: str) -> None:
    result = update_monthly_forecast(sample_database_url, as_of=date(2026, 5, 26))

    with psycopg.connect(sample_database_url) as connection:
        row = connection.execute(
            """
            SELECT
                income_received,
                fixed_costs_paid,
                fixed_costs_upcoming,
                variable_spent,
                predicted_variable_remaining,
                target_savings,
                safety_buffer,
                safe_to_spend,
                safe_per_day,
                projected_savings,
                confidence,
                explanation_json->>'formula'
            FROM monthly_forecasts
            WHERE year_month = '2026-05'
            """
        ).fetchone()

    assert result.year_month == "2026-05"
    assert result.safe_to_spend == Decimal("558.00")
    assert result.safe_per_day == Decimal("93.00")
    assert row == (
        Decimal("5258.00"),
        Decimal("1450.00"),
        Decimal("620.00"),
        Decimal("196.40"),
        Decimal("37.77"),
        Decimal("1000.00"),
        Decimal("1000.00"),
        Decimal("558.00"),
        Decimal("93.00"),
        Decimal("1558.00"),
        "low",
        (
            "current_liquid_balance + expected_income_remaining - fixed_costs_upcoming "
            "- predicted_variable_remaining - target_savings_remaining - safety_buffer"
        ),
    )
