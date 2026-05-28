"""Authentication and request authorization helpers."""

from __future__ import annotations

from collections.abc import Callable
from functools import wraps
from typing import Any

from flask import Response, abort, current_app, g, request, session
from flask.typing import ResponseReturnValue
from flask_oidc import OpenIDConnect

oidc = OpenIDConnect()

PUBLIC_ENDPOINTS = {"health", "static"}
PUBLIC_PATHS = {"/favicon.ico"}


def init_auth(app: Any) -> None:
    """Initialize Flask-OIDC and default route protection."""

    oidc.init_app(app)
    app.before_request(_require_allowed_user)


def current_user_profile() -> dict[str, Any]:
    profile = session.get("oidc_auth_profile", {})
    if isinstance(profile, dict):
        return profile
    return {}


def current_user_email() -> str:
    profile = current_user_profile()
    email = profile.get("email", "")
    return email.lower() if isinstance(email, str) else ""


def _is_public_request() -> bool:
    if request.endpoint in PUBLIC_ENDPOINTS:
        return True
    return request.path in PUBLIC_PATHS


def _require_allowed_user() -> ResponseReturnValue | None:
    if _is_public_request():
        return None

    if not oidc.user_loggedin:
        return oidc.redirect_to_auth_server()

    allowed_emails: tuple[str, ...] = current_app.config["APP_CONFIG"].allowed_emails
    email = current_user_email()
    if allowed_emails and email not in allowed_emails:
        abort(403)

    g.user_email = email
    return None


def require_post_csrf(view: Callable[..., ResponseReturnValue]) -> Callable[..., ResponseReturnValue]:
    """Small CSRF guard for future state-changing form routes."""

    @wraps(view)
    def wrapped(*args: Any, **kwargs: Any) -> ResponseReturnValue:
        token = session.get("csrf_token")
        if request.form.get("csrf_token") != token:
            return Response("Invalid CSRF token", status=400)
        return view(*args, **kwargs)

    return wrapped
