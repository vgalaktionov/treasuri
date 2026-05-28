from __future__ import annotations

import pytest

from app.config import AppConfig
from app.web import create_app


@pytest.fixture
def test_config() -> AppConfig:
    return AppConfig(
        app_env="test",
        secret_key="test-secret",
        allowed_emails=("dev-user@example.test",),
        oidc_enabled=False,
        oidc_testing_profile={
            "sub": "dev-user",
            "nickname": "dev-user",
            "email": "dev-user@example.test",
            "groups": ["finance-app"],
        },
        oidc_cookie_secure=False,
        llm_enabled=False,
        bank_provider="fake",
    )


@pytest.fixture
def app(test_config: AppConfig):
    app = create_app(test_config, {"TESTING": True})
    return app


@pytest.fixture
def client(app):
    return app.test_client()
