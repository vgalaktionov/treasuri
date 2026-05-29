from __future__ import annotations

import html

from app.config import AppConfig
from app.web import create_app


def test_health_is_public(client) -> None:
    response = client.get("/healthz")

    assert response.status_code == 200
    assert response.json == {"status": "ok"}


def test_dashboard_renders_for_allowed_test_profile(client) -> None:
    response = client.get("/")

    assert response.status_code == 200
    html_text = html.unescape(response.get_data(as_text=True))
    assert '<a class="brand" href="/" aria-label="💸 Treasuri">' in html_text
    assert '<span class="brand-mark" aria-hidden="true">💸</span>' in html_text
    assert b"Safe to spend" in response.data
    assert b"EUR 558" in response.data


def test_pwa_icon_uses_flying_stack_of_bills(client) -> None:
    response = client.get("/static/icons/icon.svg")

    assert response.status_code == 200
    assert 'aria-label="💸"'.encode() in response.data
    assert ">💸</text>".encode() in response.data


def test_app_route_rejects_disallowed_test_profile(test_config: AppConfig) -> None:
    disallowed_config = AppConfig(
        app_env="test",
        secret_key="test-secret",
        allowed_emails=("allowed@example.test",),
        oidc_enabled=False,
        oidc_testing_profile={
            "sub": "dev-user",
            "email": "dev-user@example.test",
        },
        oidc_cookie_secure=False,
    )
    app = create_app(disallowed_config, {"TESTING": True})

    response = app.test_client().get("/")

    assert response.status_code == 403


def test_app_route_rejects_missing_allowed_email_list() -> None:
    app = create_app(
        AppConfig(
            app_env="test",
            secret_key="test-secret",
            allowed_emails=(),
            oidc_enabled=False,
            oidc_testing_profile={
                "sub": "dev-user",
                "email": "dev-user@example.test",
            },
            oidc_cookie_secure=False,
        ),
        {"TESTING": True},
    )

    response = app.test_client().get("/")

    assert response.status_code == 403


def test_status_shows_llm_model(client) -> None:
    response = client.get("/status")

    assert response.status_code == 200
    assert b"unsloth/gemma-4-E4B-it-GGUF" in response.data
