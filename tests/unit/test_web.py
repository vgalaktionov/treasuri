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


def test_logout_clears_session_and_renders_public_signed_out_page(client) -> None:
    more_response = client.get("/more")
    csrf_token = _extract_csrf(more_response.get_data(as_text=True))

    with client.session_transaction() as user_session:
        user_session["sample"] = "value"

    response = client.post("/logout", data={"csrf_token": csrf_token}, follow_redirects=True)

    assert response.status_code == 200
    assert b"Signed out" in response.data
    with client.session_transaction() as user_session:
        assert "sample" not in user_session
        assert "csrf_token" not in user_session


def test_logged_out_page_is_public_for_disallowed_profile() -> None:
    app = create_app(
        AppConfig(
            app_env="test",
            secret_key="test-secret",
            allowed_emails=("allowed@example.test",),
            oidc_enabled=False,
            oidc_testing_profile={
                "sub": "dev-user",
                "email": "dev-user@example.test",
            },
            oidc_cookie_secure=False,
        ),
        {"TESTING": True},
    )

    response = app.test_client().get("/logged-out")

    assert response.status_code == 200
    assert b"Signed out" in response.data


def test_status_shows_llm_model(client) -> None:
    response = client.get("/status")

    assert response.status_code == 200
    assert b"unsloth/gemma-4-E4B-it-GGUF" in response.data


def _extract_csrf(html_text: str) -> str:
    marker = 'name="csrf_token" value="'
    start = html_text.find(marker)
    if start == -1:
        raise AssertionError("CSRF token was not rendered")
    start += len(marker)
    end = html_text.find('"', start)
    if end == -1:
        raise AssertionError("CSRF token was not closed")
    return html_text[start:end]
