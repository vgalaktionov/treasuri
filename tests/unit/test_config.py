from __future__ import annotations

from datetime import timedelta

import pytest

from app.config import ConfigError, load_config


def test_load_config_parses_oidc_testing_profile(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OIDC_ENABLED", "false")
    monkeypatch.setenv("OIDC_TESTING_PROFILE_JSON", '{"email":"dev-user@example.test"}')
    monkeypatch.setenv("ALLOWED_EMAILS", "dev-user@example.test,other@example.test")
    monkeypatch.setenv("OIDC_OPENID_REALM", "test-realm")
    monkeypatch.setenv("WORKER_CONCURRENCY", "4")

    config = load_config()

    assert config.oidc_enabled is False
    assert config.oidc_openid_realm == "test-realm"
    assert config.worker_concurrency == 4
    assert config.oidc_testing_profile["email"] == "dev-user@example.test"
    assert config.allowed_emails == ("dev-user@example.test", "other@example.test")
    assert str(config.llm_confidence_threshold) == "0.60"
    assert config.to_flask_config()["PERMANENT_SESSION_LIFETIME"] == timedelta(minutes=480)


def test_load_config_parses_runtime_identity(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OIDC_ENABLED", "false")
    monkeypatch.setenv("APP_VERSION", "1.2.3-test")
    monkeypatch.setenv("GIT_SHA", "abcdef1234567890")

    config = load_config()

    assert config.app_version == "1.2.3-test"
    assert config.git_sha == "abcdef1234567890"


def test_load_config_parses_llm_confidence_threshold(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OIDC_ENABLED", "false")
    monkeypatch.setenv("LLM_CLASSIFICATION_CONFIDENCE_THRESHOLD", "0.72")
    monkeypatch.setenv("LLM_CLASSIFICATION_TEMPERATURE", "0.1")

    config = load_config()

    assert str(config.llm_confidence_threshold) == "0.72"
    assert config.llm_temperature == 0.1


def test_load_config_rejects_invalid_llm_confidence_threshold(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OIDC_ENABLED", "false")
    monkeypatch.setenv("LLM_CLASSIFICATION_CONFIDENCE_THRESHOLD", "high")

    with pytest.raises(ConfigError, match="LLM_CLASSIFICATION_CONFIDENCE_THRESHOLD"):
        load_config()


def test_load_config_rejects_out_of_range_llm_confidence_threshold(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OIDC_ENABLED", "false")
    monkeypatch.setenv("LLM_CLASSIFICATION_CONFIDENCE_THRESHOLD", "1.2")

    with pytest.raises(ConfigError, match="between 0 and 1"):
        load_config()


def test_load_config_rejects_invalid_llm_temperature(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OIDC_ENABLED", "false")
    monkeypatch.setenv("LLM_CLASSIFICATION_TEMPERATURE", "warm")

    with pytest.raises(ConfigError, match="LLM_CLASSIFICATION_TEMPERATURE"):
        load_config()


def test_load_config_rejects_negative_llm_temperature(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OIDC_ENABLED", "false")
    monkeypatch.setenv("LLM_CLASSIFICATION_TEMPERATURE", "-0.1")

    with pytest.raises(ConfigError, match="LLM_CLASSIFICATION_TEMPERATURE"):
        load_config()


def test_load_config_rejects_non_positive_llm_timeout(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OIDC_ENABLED", "false")
    monkeypatch.setenv("LLM_TIMEOUT_SECONDS", "0")

    with pytest.raises(ConfigError, match="LLM_TIMEOUT_SECONDS"):
        load_config()


def test_load_config_rejects_non_positive_abn_sync_pages(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OIDC_ENABLED", "false")
    monkeypatch.setenv("ABN_SYNC_PAGES", "0")

    with pytest.raises(ConfigError, match="ABN_SYNC_PAGES"):
        load_config()


def test_load_config_rejects_non_positive_session_lifetime(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OIDC_ENABLED", "false")
    monkeypatch.setenv("SESSION_LIFETIME_MINUTES", "0")

    with pytest.raises(ConfigError, match="SESSION_LIFETIME_MINUTES"):
        load_config()


def test_load_config_rejects_non_positive_worker_concurrency(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OIDC_ENABLED", "false")
    monkeypatch.setenv("WORKER_CONCURRENCY", "0")

    with pytest.raises(ConfigError, match="WORKER_CONCURRENCY"):
        load_config()


def test_load_config_rejects_invalid_testing_profile_json(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OIDC_ENABLED", "false")
    monkeypatch.setenv("OIDC_TESTING_PROFILE_JSON", "{broken")

    with pytest.raises(ConfigError, match="OIDC_TESTING_PROFILE_JSON"):
        load_config()
