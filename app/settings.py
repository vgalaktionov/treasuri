"""User-configurable forecast assumptions."""

from __future__ import annotations

import json
from dataclasses import dataclass
from decimal import Decimal

import psycopg
from psycopg import Connection

FORECAST_SETTING_KEYS = (
    "current_liquid_balance",
    "target_monthly_savings",
    "safety_buffer",
    "fixed_costs_upcoming",
    "variable_baseline_3m",
    "variable_baseline_6m",
)


@dataclass(frozen=True)
class ForecastSettings:
    current_liquid_balance: Decimal
    target_monthly_savings: Decimal
    safety_buffer: Decimal
    fixed_costs_upcoming: Decimal
    variable_baseline_3m: Decimal
    variable_baseline_6m: Decimal

    def as_form_values(self) -> dict[str, str]:
        return {key: _format_decimal(getattr(self, key)) for key in FORECAST_SETTING_KEYS}


DEFAULT_FORECAST_SETTINGS = ForecastSettings(
    current_liquid_balance=Decimal("0.00"),
    target_monthly_savings=Decimal("1000.00"),
    safety_buffer=Decimal("1000.00"),
    fixed_costs_upcoming=Decimal("0.00"),
    variable_baseline_3m=Decimal("0.00"),
    variable_baseline_6m=Decimal("0.00"),
)


def load_forecast_settings(database_url: str) -> ForecastSettings:
    with psycopg.connect(database_url) as connection:
        rows = connection.execute(
            "SELECT key, value_json FROM app_settings WHERE key = ANY(%s)",
            (list(FORECAST_SETTING_KEYS),),
        ).fetchall()
    values = {str(row[0]): Decimal(str(row[1])) for row in rows}
    return ForecastSettings(
        current_liquid_balance=values.get("current_liquid_balance", DEFAULT_FORECAST_SETTINGS.current_liquid_balance),
        target_monthly_savings=values.get("target_monthly_savings", DEFAULT_FORECAST_SETTINGS.target_monthly_savings),
        safety_buffer=values.get("safety_buffer", DEFAULT_FORECAST_SETTINGS.safety_buffer),
        fixed_costs_upcoming=values.get("fixed_costs_upcoming", DEFAULT_FORECAST_SETTINGS.fixed_costs_upcoming),
        variable_baseline_3m=values.get("variable_baseline_3m", DEFAULT_FORECAST_SETTINGS.variable_baseline_3m),
        variable_baseline_6m=values.get("variable_baseline_6m", DEFAULT_FORECAST_SETTINGS.variable_baseline_6m),
    )


def save_forecast_settings(database_url: str, settings: ForecastSettings) -> None:
    with psycopg.connect(database_url) as connection:
        with connection.transaction():
            save_forecast_settings_in_connection(connection, settings)


def save_forecast_settings_in_connection(
    connection: Connection[tuple[object, ...]],
    settings: ForecastSettings,
) -> None:
    for key, value in settings.as_form_values().items():
        connection.execute(
            """
            INSERT INTO app_settings (key, value_json)
            VALUES (%s, %s::jsonb)
            ON CONFLICT (key)
            DO UPDATE SET value_json = EXCLUDED.value_json, updated_at = now()
            """,
            (key, json.dumps(value)),
        )


def parse_forecast_settings(form: dict[str, str]) -> ForecastSettings:
    return ForecastSettings(
        current_liquid_balance=_parse_money(form["current_liquid_balance"]),
        target_monthly_savings=_parse_money(form["target_monthly_savings"]),
        safety_buffer=_parse_money(form["safety_buffer"]),
        fixed_costs_upcoming=_parse_money(form["fixed_costs_upcoming"]),
        variable_baseline_3m=_parse_money(form["variable_baseline_3m"]),
        variable_baseline_6m=_parse_money(form["variable_baseline_6m"]),
    )


def _parse_money(value: str) -> Decimal:
    normalized = value.strip().replace(",", "")
    if normalized == "":
        raise ValueError("money value cannot be empty")
    return Decimal(normalized).quantize(Decimal("0.01"))


def _format_decimal(value: Decimal) -> str:
    return f"{value:.2f}"
