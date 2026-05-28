"""User-configurable forecast assumptions."""

from __future__ import annotations

import json
from dataclasses import dataclass
from decimal import Decimal

import psycopg
from psycopg import Connection

from app.config import AppConfig

FORECAST_SETTING_KEYS = (
    "current_liquid_balance",
    "target_monthly_savings",
    "safety_buffer",
    "fixed_costs_upcoming",
    "variable_baseline_3m",
    "variable_baseline_6m",
)

CLASSIFICATION_SETTING_KEYS = (
    "llm_enabled",
    "llm_confidence_threshold",
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


@dataclass(frozen=True)
class ClassificationSettings:
    llm_enabled: bool
    llm_confidence_threshold: Decimal

    def as_form_values(self) -> dict[str, object]:
        return {
            "llm_enabled": self.llm_enabled,
            "llm_confidence_threshold": _format_decimal(self.llm_confidence_threshold),
        }


def default_classification_settings(config: AppConfig) -> ClassificationSettings:
    return ClassificationSettings(
        llm_enabled=config.llm_enabled,
        llm_confidence_threshold=config.llm_confidence_threshold,
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


def load_classification_settings(database_url: str, config: AppConfig) -> ClassificationSettings:
    defaults = default_classification_settings(config)
    with psycopg.connect(database_url) as connection:
        rows = connection.execute(
            "SELECT key, value_json FROM app_settings WHERE key = ANY(%s)",
            (list(CLASSIFICATION_SETTING_KEYS),),
        ).fetchall()
    values = {str(row[0]): row[1] for row in rows}
    return ClassificationSettings(
        llm_enabled=_setting_bool(values.get("llm_enabled"), defaults.llm_enabled),
        llm_confidence_threshold=_setting_decimal(
            values.get("llm_confidence_threshold"),
            defaults.llm_confidence_threshold,
        ),
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


def save_classification_settings(database_url: str, settings: ClassificationSettings) -> None:
    with psycopg.connect(database_url) as connection:
        with connection.transaction():
            save_classification_settings_in_connection(connection, settings)


def save_classification_settings_in_connection(
    connection: Connection[tuple[object, ...]],
    settings: ClassificationSettings,
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


def parse_classification_settings(form: dict[str, str], config: AppConfig) -> ClassificationSettings:
    defaults = default_classification_settings(config)
    threshold = form.get("llm_confidence_threshold", "").strip()
    return ClassificationSettings(
        llm_enabled=form.get("llm_enabled") == "true",
        llm_confidence_threshold=_parse_threshold(threshold) if threshold else defaults.llm_confidence_threshold,
    )


def _parse_money(value: str) -> Decimal:
    normalized = value.strip().replace(",", "")
    if normalized == "":
        raise ValueError("money value cannot be empty")
    return Decimal(normalized).quantize(Decimal("0.01"))


def _parse_threshold(value: str) -> Decimal:
    threshold = Decimal(value.strip()).quantize(Decimal("0.01"))
    if threshold < 0 or threshold > 1:
        raise ValueError("llm confidence threshold must be between 0 and 1")
    return threshold


def _setting_bool(value: object, default: bool) -> bool:
    if isinstance(value, bool):
        return value
    if value is None:
        return default
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


def _setting_decimal(value: object, default: Decimal) -> Decimal:
    if value is None:
        return default
    return Decimal(str(value))


def _format_decimal(value: Decimal) -> str:
    return f"{value:.2f}"
