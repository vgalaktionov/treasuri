"""Flask web process entrypoint."""

from __future__ import annotations

from typing import Any, cast

from flask import Flask, render_template
from whitenoise import WhiteNoise

from app.auth import init_auth
from app.config import AppConfig, load_config


def create_app(config: AppConfig | None = None, overrides: dict[str, Any] | None = None) -> Flask:
    app_config = config or load_config()
    app = Flask(__name__)
    app.config.update(app_config.to_flask_config())
    if overrides:
        app.config.update(overrides)

    init_auth(app)
    register_routes(app)

    if not app_config.is_development:
        app.wsgi_app = cast(Any, WhiteNoise(app.wsgi_app, root="app/static", prefix="static/"))

    return app


def register_routes(app: Flask) -> None:
    @app.get("/healthz")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/")
    def dashboard() -> str:
        summary = {
            "month": "Sample month",
            "safe_to_spend": "EUR 558",
            "safe_per_day": "EUR 93/day",
            "projected_savings": "EUR 1,087",
            "target_savings": "EUR 1,000",
            "confidence": "Medium",
            "pace": "EUR 142 ahead of normal pace",
            "review_count": 7,
            "last_sync": "Sample data only",
        }
        return render_template("dashboard.html", summary=summary)

    @app.get("/status")
    def status() -> str:
        app_config: AppConfig = app.config["APP_CONFIG"]
        return render_template("status.html", config=app_config)


def main() -> None:
    app_config = load_config()
    app = create_app(app_config)
    app.run(host=app_config.http_host, port=app_config.http_port)


if __name__ == "__main__":
    main()
