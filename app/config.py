"""Environment-driven application configuration."""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from datetime import timedelta
from decimal import Decimal, InvalidOperation
from importlib.metadata import PackageNotFoundError, version
from typing import Any


class ConfigError(ValueError):
    """Raised when environment configuration is invalid."""


def _read_bool(name: str, default: bool) -> bool:
    raw_value = os.environ.get(name)
    if raw_value is None:
        return default
    normalized = raw_value.strip().lower()
    if normalized in {"1", "true", "yes", "on"}:
        return True
    if normalized in {"0", "false", "no", "off"}:
        return False
    raise ConfigError(f"{name} must be a boolean value")


def _read_int(name: str, default: int) -> int:
    raw_value = os.environ.get(name)
    if raw_value is None:
        return default
    try:
        return int(raw_value)
    except ValueError as exc:
        raise ConfigError(f"{name} must be an integer") from exc


def _read_optional_int(name: str) -> int | None:
    raw_value = os.environ.get(name)
    if raw_value is None or raw_value.strip() == "":
        return None
    try:
        return int(raw_value)
    except ValueError as exc:
        raise ConfigError(f"{name} must be an integer") from exc


def _read_decimal(name: str, default: str) -> Decimal:
    raw_value = os.environ.get(name, default)
    try:
        return Decimal(raw_value)
    except (InvalidOperation, ValueError) as exc:
        raise ConfigError(f"{name} must be a decimal value") from exc


def _read_float(name: str, default: str) -> float:
    raw_value = os.environ.get(name, default)
    try:
        return float(raw_value)
    except ValueError as exc:
        raise ConfigError(f"{name} must be a number") from exc


def _read_json_object(name: str, default: dict[str, Any]) -> dict[str, Any]:
    raw_value = os.environ.get(name)
    if raw_value is None or raw_value.strip() == "":
        return default
    try:
        parsed = json.loads(raw_value)
    except json.JSONDecodeError as exc:
        raise ConfigError(f"{name} must contain valid JSON") from exc
    if not isinstance(parsed, dict):
        raise ConfigError(f"{name} must be a JSON object")
    return parsed


def _read_csv(name: str, default: tuple[str, ...] = ()) -> tuple[str, ...]:
    raw_value = os.environ.get(name)
    if raw_value is None:
        return default
    return tuple(value.strip().lower() for value in raw_value.split(",") if value.strip())


def _read_git_sha() -> str:
    return (
        os.environ.get("GIT_SHA", "") or os.environ.get("SOURCE_COMMIT", "") or os.environ.get("GITHUB_SHA", "")
    ).strip()


def _read_app_version() -> str:
    raw_version = os.environ.get("APP_VERSION", "").strip()
    if raw_version:
        return raw_version
    try:
        return version("treasuri")
    except PackageNotFoundError:
        return "0.1.0"


@dataclass(frozen=True)
class AppConfig:
    """Typed config loaded from environment variables."""

    app_version: str = field(default_factory=_read_app_version)
    git_sha: str = field(default_factory=_read_git_sha)
    app_env: str = field(default_factory=lambda: os.environ.get("APP_ENV", "development"))
    secret_key: str = field(default_factory=lambda: os.environ.get("SECRET_KEY", "dev-secret-change-me"))
    database_url: str = field(default_factory=lambda: os.environ.get("DATABASE_URL", ""))
    http_host: str = field(default_factory=lambda: os.environ.get("HTTP_HOST", "127.0.0.1"))
    http_port: int = field(default_factory=lambda: _read_int("HTTP_PORT", 5000))
    allowed_emails: tuple[str, ...] = field(default_factory=lambda: _read_csv("ALLOWED_EMAILS"))
    oidc_enabled: bool = field(default_factory=lambda: _read_bool("OIDC_ENABLED", True))
    oidc_client_secrets: str = field(
        default_factory=lambda: os.environ.get("OIDC_CLIENT_SECRETS", "client_secrets.json")
    )
    oidc_openid_realm: str = field(default_factory=lambda: os.environ.get("OIDC_OPENID_REALM", "treasuri"))
    oidc_scopes: str = field(default_factory=lambda: os.environ.get("OIDC_SCOPES", "openid email profile"))
    oidc_testing_profile: dict[str, Any] = field(
        default_factory=lambda: _read_json_object("OIDC_TESTING_PROFILE_JSON", {})
    )
    oidc_cookie_secure: bool = field(default_factory=lambda: _read_bool("OIDC_ID_TOKEN_COOKIE_SECURE", True))
    session_lifetime_minutes: int = field(default_factory=lambda: _read_int("SESSION_LIFETIME_MINUTES", 480))
    worker_concurrency: int = field(default_factory=lambda: _read_int("WORKER_CONCURRENCY", 2))
    sync_lookback_days: int = field(default_factory=lambda: _read_int("SYNC_LOOKBACK_DAYS", 90))
    export_retention_days: int | None = field(default_factory=lambda: _read_optional_int("EXPORT_RETENTION_DAYS"))
    llm_enabled: bool = field(default_factory=lambda: _read_bool("LLM_ENABLED", True))
    llm_base_url: str = field(default_factory=lambda: os.environ.get("LLM_BASE_URL", "http://llama:8080/v1"))
    llm_model: str = field(
        default_factory=lambda: os.environ.get("LLM_MODEL", "unsloth/gemma-4-E4B-it-GGUF:UD-Q4_K_XL")
    )
    llm_timeout_seconds: int = field(default_factory=lambda: _read_int("LLM_TIMEOUT_SECONDS", 10))
    llm_temperature: float = field(default_factory=lambda: _read_float("LLM_CLASSIFICATION_TEMPERATURE", "0"))
    llm_confidence_threshold: Decimal = field(
        default_factory=lambda: _read_decimal("LLM_CLASSIFICATION_CONFIDENCE_THRESHOLD", "0.60")
    )
    bank_provider: str = field(default_factory=lambda: os.environ.get("BANK_PROVIDER", "fake"))
    abn_account_iban: str = field(default_factory=lambda: os.environ.get("ABN_ACCOUNT_IBAN", ""))
    abn_card_number: str = field(default_factory=lambda: os.environ.get("ABN_CARD_NUMBER", ""))
    abn_soft_token: str = field(default_factory=lambda: os.environ.get("ABN_SOFT_TOKEN", ""))
    abn_sync_pages: int = field(default_factory=lambda: _read_int("ABN_SYNC_PAGES", 1))

    @property
    def is_development(self) -> bool:
        return self.app_env in {"development", "test"}

    def validate_runtime(self) -> None:
        """Fail fast for required production/runtime configuration."""

        if not self.secret_key:
            raise ConfigError("SECRET_KEY is required")
        if self.session_lifetime_minutes < 1:
            raise ConfigError("SESSION_LIFETIME_MINUTES must be at least 1")
        if self.worker_concurrency < 1:
            raise ConfigError("WORKER_CONCURRENCY must be at least 1")
        if self.sync_lookback_days < 1:
            raise ConfigError("SYNC_LOOKBACK_DAYS must be at least 1")
        if self.export_retention_days is not None and self.export_retention_days < 1:
            raise ConfigError("EXPORT_RETENTION_DAYS must be at least 1")
        if self.llm_timeout_seconds < 1:
            raise ConfigError("LLM_TIMEOUT_SECONDS must be at least 1")
        if self.llm_temperature < 0:
            raise ConfigError("LLM_CLASSIFICATION_TEMPERATURE must be at least 0")
        if self.llm_confidence_threshold < 0 or self.llm_confidence_threshold > 1:
            raise ConfigError("LLM_CLASSIFICATION_CONFIDENCE_THRESHOLD must be between 0 and 1")
        if self.abn_sync_pages < 1:
            raise ConfigError("ABN_SYNC_PAGES must be at least 1")
        if self.oidc_enabled and not self.oidc_client_secrets:
            raise ConfigError("OIDC_CLIENT_SECRETS is required when OIDC_ENABLED=true")

    def to_flask_config(self) -> dict[str, Any]:
        return {
            "SECRET_KEY": self.secret_key,
            "APP_CONFIG": self,
            "DATABASE_URL": self.database_url,
            "OIDC_ENABLED": self.oidc_enabled,
            "OIDC_CLIENT_SECRETS": self.oidc_client_secrets,
            "OIDC_SCOPES": self.oidc_scopes,
            "OIDC_TESTING_PROFILE": self.oidc_testing_profile,
            "OIDC_ID_TOKEN_COOKIE_SECURE": self.oidc_cookie_secure,
            "PERMANENT_SESSION_LIFETIME": timedelta(minutes=self.session_lifetime_minutes),
            "SESSION_COOKIE_HTTPONLY": True,
            "SESSION_COOKIE_SAMESITE": "Lax",
            "SESSION_COOKIE_SECURE": not self.is_development,
        }


def load_config() -> AppConfig:
    config = AppConfig()
    config.validate_runtime()
    return config
