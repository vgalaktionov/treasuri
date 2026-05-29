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
    "salary_day",
    "baseline_months",
    "sync_lookback_days",
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
    salary_day: int
    baseline_months: int
    sync_lookback_days: int
    fixed_costs_upcoming: Decimal
    variable_baseline_3m: Decimal
    variable_baseline_6m: Decimal

    def as_form_values(self) -> dict[str, object]:
        return {
            "current_liquid_balance": _format_decimal(self.current_liquid_balance),
            "target_monthly_savings": _format_decimal(self.target_monthly_savings),
            "safety_buffer": _format_decimal(self.safety_buffer),
            "salary_day": self.salary_day,
            "baseline_months": self.baseline_months,
            "sync_lookback_days": self.sync_lookback_days,
            "fixed_costs_upcoming": _format_decimal(self.fixed_costs_upcoming),
            "variable_baseline_3m": _format_decimal(self.variable_baseline_3m),
            "variable_baseline_6m": _format_decimal(self.variable_baseline_6m),
        }


DEFAULT_FORECAST_SETTINGS = ForecastSettings(
    current_liquid_balance=Decimal("0.00"),
    target_monthly_savings=Decimal("1000.00"),
    safety_buffer=Decimal("1000.00"),
    salary_day=24,
    baseline_months=6,
    sync_lookback_days=90,
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


@dataclass(frozen=True)
class SettingsAccount:
    name: str
    provider: str
    iban: str
    currency: str
    status: str


@dataclass(frozen=True)
class SettingsTaxonomy:
    category_count: int
    sample_categories: tuple[str, ...]


@dataclass(frozen=True)
class SettingsSync:
    schedule: str
    lookback_days: int
    last_sync: str


@dataclass(frozen=True)
class SettingsOverview:
    accounts: tuple[SettingsAccount, ...]
    taxonomy: SettingsTaxonomy
    sync: SettingsSync


DEFAULT_SETTINGS_OVERVIEW = SettingsOverview(
    accounts=(),
    taxonomy=SettingsTaxonomy(category_count=0, sample_categories=()),
    sync=SettingsSync(
        schedule="Manual sync", lookback_days=DEFAULT_FORECAST_SETTINGS.sync_lookback_days, last_sync="No sync runs yet"
    ),
)


def default_classification_settings(config: AppConfig) -> ClassificationSettings:
    return ClassificationSettings(
        llm_enabled=config.llm_enabled,
        llm_confidence_threshold=config.llm_confidence_threshold,
    )


def load_settings_overview(database_url: str, forecast_settings: ForecastSettings) -> SettingsOverview:
    with psycopg.connect(database_url) as connection:
        account_rows = connection.execute(
            """
            SELECT name, provider, iban, currency, is_active
            FROM accounts
            ORDER BY is_active DESC, provider, name
            """
        ).fetchall()
        category_rows = connection.execute(
            """
            SELECT name
            FROM categories
            ORDER BY name
            """
        ).fetchall()
        sync_row = connection.execute(
            """
            SELECT provider, status, finished_at
            FROM sync_runs
            ORDER BY started_at DESC
            LIMIT 1
            """
        ).fetchone()
    categories = tuple(str(row[0]) for row in category_rows)
    return SettingsOverview(
        accounts=tuple(
            SettingsAccount(
                name=str(row[0]),
                provider=str(row[1]),
                iban=str(row[2]),
                currency=str(row[3]),
                status="Active" if bool(row[4]) else "Inactive",
            )
            for row in account_rows
        ),
        taxonomy=SettingsTaxonomy(
            category_count=len(categories),
            sample_categories=categories[:6],
        ),
        sync=SettingsSync(
            schedule="Manual sync",
            lookback_days=forecast_settings.sync_lookback_days,
            last_sync=_format_sync_row(sync_row),
        ),
    )


def load_forecast_settings(database_url: str) -> ForecastSettings:
    with psycopg.connect(database_url) as connection:
        rows = connection.execute(
            "SELECT key, value_json FROM app_settings WHERE key = ANY(%s)",
            (list(FORECAST_SETTING_KEYS),),
        ).fetchall()
    values = {str(row[0]): row[1] for row in rows}
    return ForecastSettings(
        current_liquid_balance=_setting_decimal(
            values.get("current_liquid_balance"),
            DEFAULT_FORECAST_SETTINGS.current_liquid_balance,
        ),
        target_monthly_savings=_setting_decimal(
            values.get("target_monthly_savings"),
            DEFAULT_FORECAST_SETTINGS.target_monthly_savings,
        ),
        safety_buffer=_setting_decimal(values.get("safety_buffer"), DEFAULT_FORECAST_SETTINGS.safety_buffer),
        salary_day=_setting_int(values.get("salary_day"), DEFAULT_FORECAST_SETTINGS.salary_day),
        baseline_months=_setting_int(values.get("baseline_months"), DEFAULT_FORECAST_SETTINGS.baseline_months),
        sync_lookback_days=_setting_int(
            values.get("sync_lookback_days"),
            DEFAULT_FORECAST_SETTINGS.sync_lookback_days,
        ),
        fixed_costs_upcoming=_setting_decimal(
            values.get("fixed_costs_upcoming"),
            DEFAULT_FORECAST_SETTINGS.fixed_costs_upcoming,
        ),
        variable_baseline_3m=_setting_decimal(
            values.get("variable_baseline_3m"),
            DEFAULT_FORECAST_SETTINGS.variable_baseline_3m,
        ),
        variable_baseline_6m=_setting_decimal(
            values.get("variable_baseline_6m"),
            DEFAULT_FORECAST_SETTINGS.variable_baseline_6m,
        ),
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
        salary_day=_parse_int(form["salary_day"], field_name="salary day", minimum=1, maximum=31),
        baseline_months=_parse_int(form["baseline_months"], field_name="baseline months", minimum=1, maximum=24),
        sync_lookback_days=_parse_int(
            form["sync_lookback_days"],
            field_name="sync lookback days",
            minimum=1,
            maximum=3650,
        ),
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


def _parse_int(value: str, *, field_name: str, minimum: int, maximum: int) -> int:
    try:
        parsed = int(value.strip())
    except ValueError as exc:
        raise ValueError(f"{field_name} must be an integer") from exc
    if not minimum <= parsed <= maximum:
        raise ValueError(f"{field_name} must be between {minimum} and {maximum}")
    return parsed


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


def _setting_int(value: object, default: int) -> int:
    if value is None:
        return default
    if isinstance(value, int):
        return value
    return int(str(value))


def _format_decimal(value: Decimal) -> str:
    return f"{value:.2f}"


def _format_sync_row(row: tuple[object, ...] | None) -> str:
    if row is None:
        return "No sync runs yet"
    provider = str(row[0])
    status = str(row[1])
    finished_at = row[2]
    if finished_at is None:
        return f"{provider} {status}"
    return f"{provider} {status} at {finished_at}"
