"""Database-backed monthly forecast calculation."""

from __future__ import annotations

import json
from calendar import monthrange
from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from typing import LiteralString

import psycopg
from psycopg import Connection

from app.forecast.calculator import (
    ForecastInputs,
    VariableSpendInputs,
    calculate_safe_to_spend,
    predict_variable_spend,
)


@dataclass(frozen=True)
class MonthlyForecastUpdate:
    year_month: str
    safe_to_spend: Decimal
    safe_per_day: Decimal
    confidence: str
    review_count: int


def update_monthly_forecast(database_url: str, *, as_of: date | None = None) -> MonthlyForecastUpdate:
    forecast_date = as_of or date.today()
    with psycopg.connect(database_url) as connection:
        with connection.transaction():
            return update_monthly_forecast_in_connection(connection, as_of=forecast_date)


def update_monthly_forecast_in_connection(
    connection: Connection[tuple[object, ...]], *, as_of: date
) -> MonthlyForecastUpdate:
    year_month = as_of.strftime("%Y-%m")
    settings = _load_settings(connection)
    current_liquid_balance = _setting_decimal(
        settings,
        "current_liquid_balance",
        _current_net_cashflow(connection, year_month),
    )
    target_savings = _setting_decimal(settings, "target_monthly_savings", Decimal("1000.00"))
    safety_buffer = _setting_decimal(settings, "safety_buffer", Decimal("1000.00"))
    fixed_costs_upcoming = _setting_decimal(settings, "fixed_costs_upcoming", Decimal("0.00"))
    baseline_3m = _setting_decimal(settings, "variable_baseline_3m", Decimal("0.00"))
    baseline_6m = _setting_decimal(settings, "variable_baseline_6m", Decimal("0.00"))

    income_received = _income_received(connection, year_month)
    fixed_costs_paid = _fixed_costs_paid(connection, year_month)
    variable_spent = _variable_spent(connection, year_month)
    expected_income_remaining = Decimal("0.00")
    days_in_month = monthrange(as_of.year, as_of.month)[1]
    elapsed_days = min(as_of.day, days_in_month)
    days_left = days_in_month - as_of.day + 1
    inputs = VariableSpendInputs(
        baseline_3m=baseline_3m,
        baseline_6m=baseline_6m,
        current_spend=variable_spent,
        elapsed_days=elapsed_days,
        days_in_month=days_in_month,
    )
    variable_prediction = predict_variable_spend(inputs)
    forecast = calculate_safe_to_spend(
        ForecastInputs(
            current_liquid_balance=current_liquid_balance,
            expected_income_remaining=expected_income_remaining,
            fixed_costs_upcoming=fixed_costs_upcoming,
            predicted_variable_remaining=variable_prediction.predicted_remaining,
            target_savings_remaining=target_savings,
            safety_buffer=safety_buffer,
            days_left_in_month=days_left,
        )
    )
    review_count = _review_count(connection)
    confidence = "low" if review_count > 0 else "medium"
    projected_savings = forecast.safe_to_spend + target_savings
    explanation = {
        **forecast.explanation,
        "income_received": str(income_received),
        "fixed_costs_paid": str(fixed_costs_paid),
        "variable_spent": str(variable_spent),
        "pace_projection": str(variable_prediction.pace_projection),
        "predicted_month_end": str(variable_prediction.predicted_month_end),
        "variable_prediction_inputs": {
            "baseline_3m": str(inputs.baseline_3m),
            "baseline_6m": str(inputs.baseline_6m),
            "elapsed_days": str(inputs.elapsed_days),
            "days_in_month": str(inputs.days_in_month),
        },
    }

    connection.execute(
        """
        INSERT INTO monthly_forecasts (
            year_month,
            income_received,
            expected_income_remaining,
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
            explanation_json
        )
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb)
        ON CONFLICT (year_month)
        DO UPDATE SET
            income_received = EXCLUDED.income_received,
            expected_income_remaining = EXCLUDED.expected_income_remaining,
            fixed_costs_paid = EXCLUDED.fixed_costs_paid,
            fixed_costs_upcoming = EXCLUDED.fixed_costs_upcoming,
            variable_spent = EXCLUDED.variable_spent,
            predicted_variable_remaining = EXCLUDED.predicted_variable_remaining,
            target_savings = EXCLUDED.target_savings,
            safety_buffer = EXCLUDED.safety_buffer,
            safe_to_spend = EXCLUDED.safe_to_spend,
            safe_per_day = EXCLUDED.safe_per_day,
            projected_savings = EXCLUDED.projected_savings,
            confidence = EXCLUDED.confidence,
            explanation_json = EXCLUDED.explanation_json,
            updated_at = now()
        """,
        (
            year_month,
            income_received,
            expected_income_remaining,
            fixed_costs_paid,
            fixed_costs_upcoming,
            variable_spent,
            variable_prediction.predicted_remaining,
            target_savings,
            safety_buffer,
            forecast.safe_to_spend,
            forecast.safe_per_day,
            projected_savings,
            confidence,
            json.dumps(explanation, sort_keys=True),
        ),
    )

    return MonthlyForecastUpdate(
        year_month=year_month,
        safe_to_spend=forecast.safe_to_spend,
        safe_per_day=forecast.safe_per_day,
        confidence=confidence,
        review_count=review_count,
    )


def _load_settings(connection: Connection[tuple[object, ...]]) -> dict[str, object]:
    rows = connection.execute("SELECT key, value_json FROM app_settings").fetchall()
    return {str(row[0]): row[1] for row in rows}


def _setting_decimal(settings: dict[str, object], key: str, default: Decimal) -> Decimal:
    value = settings.get(key)
    if value is None:
        return default
    return Decimal(str(value))


def _current_net_cashflow(connection: Connection[tuple[object, ...]], year_month: str) -> Decimal:
    return _sum_decimal(
        connection,
        """
        SELECT COALESCE(sum(raw_transactions.amount), 0)
        FROM raw_transactions
        WHERE to_char(raw_transactions.booking_date, 'YYYY-MM') = %s
        """,
        (year_month,),
    )


def _income_received(connection: Connection[tuple[object, ...]], year_month: str) -> Decimal:
    return _sum_decimal(
        connection,
        """
        SELECT COALESCE(sum(raw_transactions.amount), 0)
        FROM enriched_transactions
        JOIN raw_transactions ON raw_transactions.id = enriched_transactions.raw_transaction_id
        WHERE to_char(raw_transactions.booking_date, 'YYYY-MM') = %s
            AND enriched_transactions.is_income = true
        """,
        (year_month,),
    )


def _fixed_costs_paid(connection: Connection[tuple[object, ...]], year_month: str) -> Decimal:
    return _sum_abs_decimal(
        connection,
        """
        SELECT COALESCE(sum(raw_transactions.amount), 0)
        FROM enriched_transactions
        JOIN raw_transactions ON raw_transactions.id = enriched_transactions.raw_transaction_id
        WHERE to_char(raw_transactions.booking_date, 'YYYY-MM') = %s
            AND enriched_transactions.is_fixed_cost = true
            AND raw_transactions.amount < 0
        """,
        (year_month,),
    )


def _variable_spent(connection: Connection[tuple[object, ...]], year_month: str) -> Decimal:
    return _sum_abs_decimal(
        connection,
        """
        SELECT COALESCE(sum(raw_transactions.amount), 0)
        FROM enriched_transactions
        JOIN raw_transactions ON raw_transactions.id = enriched_transactions.raw_transaction_id
        WHERE to_char(raw_transactions.booking_date, 'YYYY-MM') = %s
            AND enriched_transactions.is_variable_cost = true
            AND enriched_transactions.is_income = false
            AND enriched_transactions.is_transfer = false
            AND enriched_transactions.is_excluded_from_budget = false
            AND raw_transactions.amount < 0
        """,
        (year_month,),
    )


def _review_count(connection: Connection[tuple[object, ...]]) -> int:
    row = connection.execute("SELECT count(*) FROM enriched_transactions WHERE needs_review = true").fetchone()
    if row is None:
        return 0
    return _read_int(row[0])


def _sum_decimal(
    connection: Connection[tuple[object, ...]], query: LiteralString, params: tuple[object, ...]
) -> Decimal:
    row = connection.execute(query, params).fetchone()
    if row is None:
        return Decimal("0.00")
    return Decimal(str(row[0]))


def _sum_abs_decimal(
    connection: Connection[tuple[object, ...]], query: LiteralString, params: tuple[object, ...]
) -> Decimal:
    return abs(_sum_decimal(connection, query, params))


def _read_int(value: object) -> int:
    if not isinstance(value, int):
        raise RuntimeError(f"expected integer, got {type(value).__name__}")
    return value
