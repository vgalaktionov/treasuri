from __future__ import annotations

from decimal import Decimal

from app.admin import with_database_url
from app.config import AppConfig


def test_with_database_url_preserves_runtime_config_fields() -> None:
    config = AppConfig(
        app_version="1.2.3-test",
        git_sha="abcdef1234567890",
        app_env="test",
        secret_key="test-secret",
        database_url="postgresql://old",
        allowed_emails=("dev-user@example.test",),
        oidc_enabled=False,
        session_lifetime_minutes=37,
        llm_enabled=True,
        llm_confidence_threshold=Decimal("0.72"),
        bank_provider="fake",
    )

    updated = with_database_url(config, "postgresql://new")

    assert updated.database_url == "postgresql://new"
    assert updated.app_version == "1.2.3-test"
    assert updated.git_sha == "abcdef1234567890"
    assert updated.session_lifetime_minutes == 37
    assert updated.llm_confidence_threshold == Decimal("0.72")
    assert updated.allowed_emails == ("dev-user@example.test",)
