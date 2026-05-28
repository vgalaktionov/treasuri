"""Flask web process entrypoint."""

from __future__ import annotations

from typing import Any, cast

from flask import Flask, Response, abort, redirect, render_template, request, url_for
from whitenoise import WhiteNoise

from app.auth import init_auth, require_post_csrf
from app.config import AppConfig, load_config
from app.dashboard import FALLBACK_DASHBOARD_SUMMARY, load_dashboard_summary
from app.exports.xlsx import generate_budget_export, list_export_runs, load_export_file
from app.forecast.service import update_monthly_forecast
from app.recurring import list_recurring_series
from app.review import ReviewCorrection, apply_review_correction, list_category_names
from app.rules import create_rule, draft_rule_from_transaction, preview_rule
from app.settings import (
    DEFAULT_FORECAST_SETTINGS,
    load_forecast_settings,
    parse_forecast_settings,
    save_forecast_settings,
)
from app.transactions import list_transactions


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
        app_config: AppConfig = app.config["APP_CONFIG"]
        summary = (
            load_dashboard_summary(app_config.database_url) if app_config.database_url else FALLBACK_DASHBOARD_SUMMARY
        )
        return render_template("dashboard.html", summary=summary.as_template_context())

    @app.get("/status")
    def status() -> str:
        app_config: AppConfig = app.config["APP_CONFIG"]
        return render_template("status.html", config=app_config)

    @app.get("/transactions")
    def transactions() -> str:
        app_config: AppConfig = app.config["APP_CONFIG"]
        transactions = list_transactions(app_config.database_url) if app_config.database_url else []
        return render_template(
            "transactions.html",
            title="Transactions",
            subtitle="Latest known activity",
            transactions=transactions,
            categories=[],
            show_review_actions=False,
        )

    @app.get("/review")
    def review() -> str:
        app_config: AppConfig = app.config["APP_CONFIG"]
        transactions = list_transactions(app_config.database_url, needs_review=True) if app_config.database_url else []
        categories = list_category_names(app_config.database_url) if app_config.database_url else []
        return render_template(
            "transactions.html",
            title="Review inbox",
            subtitle="Transactions that can change the forecast",
            transactions=transactions,
            categories=categories,
            show_review_actions=True,
        )

    @app.post("/review/<int:transaction_id>/category")
    @require_post_csrf
    def update_review_category(transaction_id: int):
        app_config: AppConfig = app.config["APP_CONFIG"]
        if not app_config.database_url:
            abort(400)
        category_name = request.form.get("category", "").strip()
        if not category_name:
            abort(400)
        merchant_name = request.form.get("merchant", "").strip() or None
        apply_review_correction(
            app_config.database_url,
            ReviewCorrection(
                transaction_id=transaction_id,
                category_name=category_name,
                merchant_name=merchant_name,
            ),
        )
        if request.form.get("next") == "rule-preview":
            return redirect(url_for("preview_rule_from_transaction", transaction_id=transaction_id))
        return redirect(url_for("review"))

    @app.get("/rules/preview/from-transaction/<int:transaction_id>")
    def preview_rule_from_transaction(transaction_id: int) -> str:
        app_config: AppConfig = app.config["APP_CONFIG"]
        if not app_config.database_url:
            abort(400)
        draft = draft_rule_from_transaction(app_config.database_url, transaction_id)
        preview = preview_rule(app_config.database_url, draft)
        return render_template("rule_preview.html", preview=preview)

    @app.post("/rules/from-transaction/<int:transaction_id>")
    @require_post_csrf
    def create_rule_from_transaction(transaction_id: int):
        app_config: AppConfig = app.config["APP_CONFIG"]
        if not app_config.database_url:
            abort(400)
        draft = draft_rule_from_transaction(app_config.database_url, transaction_id)
        create_rule(app_config.database_url, draft)
        return redirect(url_for("review"))

    @app.get("/export")
    def export() -> str:
        app_config: AppConfig = app.config["APP_CONFIG"]
        runs = list_export_runs(app_config.database_url) if app_config.database_url else []
        return render_template("export.html", runs=runs)

    @app.post("/export/generate")
    @require_post_csrf
    def generate_export():
        app_config: AppConfig = app.config["APP_CONFIG"]
        if not app_config.database_url:
            abort(400)
        generate_budget_export(app_config.database_url)
        return redirect(url_for("export"))

    @app.get("/export/files/<int:file_id>")
    def download_export(file_id: int) -> Response:
        app_config: AppConfig = app.config["APP_CONFIG"]
        if not app_config.database_url:
            abort(400)
        export_file = load_export_file(app_config.database_url, file_id)
        if export_file is None:
            abort(404)
        return Response(
            export_file.content,
            headers={
                "Content-Type": export_file.content_type,
                "Content-Disposition": f'attachment; filename="{export_file.filename}"',
            },
        )

    @app.get("/settings")
    def settings() -> str:
        app_config: AppConfig = app.config["APP_CONFIG"]
        forecast_settings = (
            load_forecast_settings(app_config.database_url).as_form_values()
            if app_config.database_url
            else DEFAULT_FORECAST_SETTINGS.as_form_values()
        )
        return render_template("settings.html", settings=forecast_settings)

    @app.post("/settings")
    @require_post_csrf
    def update_settings():
        app_config: AppConfig = app.config["APP_CONFIG"]
        if not app_config.database_url:
            abort(400)
        forecast_settings = parse_forecast_settings(
            {
                "current_liquid_balance": request.form.get("current_liquid_balance", ""),
                "target_monthly_savings": request.form.get("target_monthly_savings", ""),
                "safety_buffer": request.form.get("safety_buffer", ""),
                "fixed_costs_upcoming": request.form.get("fixed_costs_upcoming", ""),
                "variable_baseline_3m": request.form.get("variable_baseline_3m", ""),
                "variable_baseline_6m": request.form.get("variable_baseline_6m", ""),
            }
        )
        save_forecast_settings(app_config.database_url, forecast_settings)
        update_monthly_forecast(app_config.database_url)
        return redirect(url_for("dashboard"))

    @app.get("/recurring")
    def recurring() -> str:
        app_config: AppConfig = app.config["APP_CONFIG"]
        series = list_recurring_series(app_config.database_url) if app_config.database_url else []
        return render_template("recurring.html", series=series)


def main() -> None:
    app_config = load_config()
    app = create_app(app_config)
    app.run(host=app_config.http_host, port=app_config.http_port)


if __name__ == "__main__":
    main()
