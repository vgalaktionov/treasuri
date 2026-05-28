from __future__ import annotations

from decimal import Decimal

import pytest

from app.forecast.calculator import ForecastInputs, VariableSpendInputs, calculate_safe_to_spend, predict_variable_spend


def test_calculate_safe_to_spend_uses_prd_formula() -> None:
    result = calculate_safe_to_spend(
        ForecastInputs(
            current_liquid_balance=Decimal("4000.00"),
            expected_income_remaining=Decimal("1000.00"),
            fixed_costs_upcoming=Decimal("620.00"),
            predicted_variable_remaining=Decimal("760.00"),
            target_savings_remaining=Decimal("1000.00"),
            safety_buffer=Decimal("1000.00"),
            days_left_in_month=6,
        )
    )

    assert result.safe_to_spend == Decimal("1620.00")
    assert result.safe_per_day == Decimal("270.00")
    assert result.explanation["formula"].startswith("current_liquid_balance")


def test_calculate_safe_to_spend_allows_negative_values() -> None:
    result = calculate_safe_to_spend(
        ForecastInputs(
            current_liquid_balance=Decimal("500.00"),
            expected_income_remaining=Decimal("0.00"),
            fixed_costs_upcoming=Decimal("620.00"),
            predicted_variable_remaining=Decimal("760.00"),
            target_savings_remaining=Decimal("1000.00"),
            safety_buffer=Decimal("1000.00"),
            days_left_in_month=4,
        )
    )

    assert result.safe_to_spend == Decimal("-2880.00")
    assert result.safe_per_day == Decimal("-720.00")


def test_calculate_safe_to_spend_requires_at_least_one_day_left() -> None:
    with pytest.raises(ValueError, match="days_left_in_month"):
        calculate_safe_to_spend(
            ForecastInputs(
                current_liquid_balance=Decimal("0"),
                expected_income_remaining=Decimal("0"),
                fixed_costs_upcoming=Decimal("0"),
                predicted_variable_remaining=Decimal("0"),
                target_savings_remaining=Decimal("0"),
                safety_buffer=Decimal("0"),
                days_left_in_month=0,
            )
        )


def test_predict_variable_spend_uses_conservative_maximum() -> None:
    prediction = predict_variable_spend(
        VariableSpendInputs(
            baseline_3m=Decimal("900.00"),
            baseline_6m=Decimal("800.00"),
            current_spend=Decimal("500.00"),
            elapsed_days=10,
            days_in_month=30,
        )
    )

    assert prediction.pace_projection == Decimal("1500.00")
    assert prediction.predicted_month_end == Decimal("1500.00")
    assert prediction.predicted_remaining == Decimal("1000.00")


def test_predict_variable_spend_never_returns_negative_remaining() -> None:
    prediction = predict_variable_spend(
        VariableSpendInputs(
            baseline_3m=Decimal("400.00"),
            baseline_6m=Decimal("450.00"),
            current_spend=Decimal("700.00"),
            elapsed_days=30,
            days_in_month=30,
        )
    )

    assert prediction.predicted_month_end == Decimal("700.00")
    assert prediction.predicted_remaining == Decimal("0.00")


def test_predict_variable_spend_validates_days() -> None:
    with pytest.raises(ValueError, match="elapsed_days"):
        predict_variable_spend(
            VariableSpendInputs(
                baseline_3m=Decimal("0"),
                baseline_6m=Decimal("0"),
                current_spend=Decimal("0"),
                elapsed_days=0,
                days_in_month=30,
            )
        )
