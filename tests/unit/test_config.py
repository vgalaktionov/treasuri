from __future__ import annotations

import pytest

from app.config import ConfigError, load_config


def test_load_config_parses_oidc_testing_profile(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OIDC_ENABLED", "false")
    monkeypatch.setenv("OIDC_TESTING_PROFILE_JSON", '{"email":"dev-user@example.test"}')
    monkeypatch.setenv("ALLOWED_EMAILS", "dev-user@example.test,other@example.test")

    config = load_config()

    assert config.oidc_enabled is False
    assert config.oidc_testing_profile["email"] == "dev-user@example.test"
    assert config.allowed_emails == ("dev-user@example.test", "other@example.test")
    assert str(config.llm_confidence_threshold) == "0.60"


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

    config = load_config()

    assert str(config.llm_confidence_threshold) == "0.72"


def test_load_config_rejects_invalid_llm_confidence_threshold(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OIDC_ENABLED", "false")
    monkeypatch.setenv("LLM_CLASSIFICATION_CONFIDENCE_THRESHOLD", "high")

    with pytest.raises(ConfigError, match="LLM_CLASSIFICATION_CONFIDENCE_THRESHOLD"):
        load_config()


def test_load_config_rejects_invalid_testing_profile_json(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OIDC_ENABLED", "false")
    monkeypatch.setenv("OIDC_TESTING_PROFILE_JSON", "{broken")

    with pytest.raises(ConfigError, match="OIDC_TESTING_PROFILE_JSON"):
        load_config()
