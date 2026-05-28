"""Deterministic forecast calculations."""

from __future__ import annotations

from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal

MONEY_QUANT = Decimal("0.01")


@dataclass(frozen=True)
class ForecastInputs:
    current_liquid_balance: Decimal
    expected_income_remaining: Decimal
    fixed_costs_upcoming: Decimal
    predicted_variable_remaining: Decimal
    target_savings_remaining: Decimal
    safety_buffer: Decimal
    days_left_in_month: int


@dataclass(frozen=True)
class ForecastResult:
    safe_to_spend: Decimal
    safe_per_day: Decimal
    explanation: dict[str, str]


@dataclass(frozen=True)
class VariableSpendInputs:
    baseline_3m: Decimal
    baseline_6m: Decimal
    current_spend: Decimal
    elapsed_days: int
    days_in_month: int


@dataclass(frozen=True)
class VariableSpendPrediction:
    predicted_month_end: Decimal
    predicted_remaining: Decimal
    pace_projection: Decimal


def quantize_money(value: Decimal) -> Decimal:
    return value.quantize(MONEY_QUANT, rounding=ROUND_HALF_UP)


def calculate_safe_to_spend(inputs: ForecastInputs) -> ForecastResult:
    if inputs.days_left_in_month < 1:
        raise ValueError("days_left_in_month must include today and be at least 1")

    safe_to_spend = quantize_money(
        inputs.current_liquid_balance
        + inputs.expected_income_remaining
        - inputs.fixed_costs_upcoming
        - inputs.predicted_variable_remaining
        - inputs.target_savings_remaining
        - inputs.safety_buffer
    )
    safe_per_day = quantize_money(safe_to_spend / Decimal(inputs.days_left_in_month))

    return ForecastResult(
        safe_to_spend=safe_to_spend,
        safe_per_day=safe_per_day,
        explanation={
            "current_liquid_balance": str(quantize_money(inputs.current_liquid_balance)),
            "expected_income_remaining": str(quantize_money(inputs.expected_income_remaining)),
            "fixed_costs_upcoming": str(quantize_money(inputs.fixed_costs_upcoming)),
            "predicted_variable_remaining": str(quantize_money(inputs.predicted_variable_remaining)),
            "target_savings_remaining": str(quantize_money(inputs.target_savings_remaining)),
            "safety_buffer": str(quantize_money(inputs.safety_buffer)),
            "days_left_in_month": str(inputs.days_left_in_month),
            "formula": (
                "current_liquid_balance + expected_income_remaining - fixed_costs_upcoming "
                "- predicted_variable_remaining - target_savings_remaining - safety_buffer"
            ),
        },
    )


def predict_variable_spend(inputs: VariableSpendInputs) -> VariableSpendPrediction:
    if inputs.elapsed_days < 1:
        raise ValueError("elapsed_days must be at least 1")
    if inputs.days_in_month < inputs.elapsed_days:
        raise ValueError("days_in_month must be greater than or equal to elapsed_days")

    pace_projection = quantize_money(inputs.current_spend / Decimal(inputs.elapsed_days) * inputs.days_in_month)
    predicted_month_end = quantize_money(max(inputs.baseline_3m, inputs.baseline_6m, pace_projection))
    predicted_remaining = quantize_money(max(Decimal("0"), predicted_month_end - inputs.current_spend))

    return VariableSpendPrediction(
        predicted_month_end=predicted_month_end,
        predicted_remaining=predicted_remaining,
        pace_projection=pace_projection,
    )
