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


def test_load_config_rejects_invalid_testing_profile_json(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OIDC_ENABLED", "false")
    monkeypatch.setenv("OIDC_TESTING_PROFILE_JSON", "{broken")

    with pytest.raises(ConfigError, match="OIDC_TESTING_PROFILE_JSON"):
        load_config()
