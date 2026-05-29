"""Flask web process entrypoint."""

from __future__ import annotations

from datetime import date
from typing import Any, cast

from flask import Flask, Response, abort, redirect, render_template, request, url_for
from whitenoise import WhiteNoise

from app.auth import current_user_email, init_auth, require_post_csrf
from app.budget import load_category_budgets
from app.config import AppConfig, load_config
from app.dashboard import FALLBACK_DASHBOARD_SUMMARY, load_dashboard_summary
from app.exports.xlsx import generate_budget_export, list_export_runs, load_export_file
from app.forecast.service import update_monthly_forecast
from app.jobs.enqueue import enqueue_backfill_rule
from app.month import FALLBACK_MONTH_SUMMARY, load_month_summary
from app.recurring import confirm_recurring_series, disable_recurring_series, list_recurring_series
from app.review import (
    ReviewCorrection,
    apply_review_correction,
    apply_review_correction_to_similar,
    list_category_names,
)
from app.rules import (
    RULE_FIELDS,
    RULE_OPERATORS,
    create_rule,
    create_rule_from_input,
    draft_rule_from_transaction,
    list_rules,
    parse_rule_editor_input,
    preview_rule,
    set_rule_active,
    update_rule_from_input,
)
from app.settings import (
    DEFAULT_FORECAST_SETTINGS,
    DEFAULT_SETTINGS_OVERVIEW,
    default_classification_settings,
    load_classification_settings,
    load_forecast_settings,
    load_settings_overview,
    parse_classification_settings,
    parse_forecast_settings,
    save_classification_settings,
    save_forecast_settings,
)
from app.status import load_status_sections
from app.transactions import TransactionFilters, get_transaction_raw_details, list_transactions


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

    @app.get("/service-worker.js")
    def service_worker() -> Response:
        response = app.send_static_file("service-worker.js")
        response.headers["Service-Worker-Allowed"] = "/"
        response.headers["Cache-Control"] = "no-cache"
        return response

    @app.get("/")
    def dashboard() -> str:
        app_config: AppConfig = app.config["APP_CONFIG"]
        summary = (
            load_dashboard_summary(app_config.database_url) if app_config.database_url else FALLBACK_DASHBOARD_SUMMARY
        )
        return render_template("dashboard.html", summary=summary.as_template_context())

    @app.get("/month")
    def month() -> str:
        app_config: AppConfig = app.config["APP_CONFIG"]
        summary = load_month_summary(app_config.database_url) if app_config.database_url else FALLBACK_MONTH_SUMMARY
        return render_template("month.html", summary=summary.as_template_context())

    @app.get("/status")
    def status() -> str:
        app_config: AppConfig = app.config["APP_CONFIG"]
        return render_template("status.html", sections=load_status_sections(app_config))

    @app.get("/more")
    def more() -> str:
        return render_template("more.html")

    @app.get("/transactions")
    def transactions() -> str:
        app_config: AppConfig = app.config["APP_CONFIG"]
        filters = TransactionFilters(
            query=request.args.get("q", "").strip(),
            month=request.args.get("month", "").strip(),
            category=request.args.get("category", "").strip(),
            min_amount=request.args.get("min_amount", "").strip(),
            max_amount=request.args.get("max_amount", "").strip(),
            kind=request.args.get("kind", "").strip(),
            needs_review=True if request.args.get("needs_review") == "1" else None,
        )
        transactions = list_transactions(app_config.database_url, filters=filters) if app_config.database_url else []
        categories = list_category_names(app_config.database_url) if app_config.database_url else []
        return render_template(
            "transactions.html",
            title="Transactions",
            subtitle="Latest known activity",
            transactions=transactions,
            categories=categories,
            filters=filters,
            show_filters=True,
            show_inline_edit=True,
            show_review_actions=False,
            return_to=request.full_path,
        )

    @app.get("/transactions/<int:transaction_id>/raw")
    def transaction_raw(transaction_id: int) -> str:
        app_config: AppConfig = app.config["APP_CONFIG"]
        if not app_config.database_url:
            abort(400)
        try:
            transaction = get_transaction_raw_details(app_config.database_url, transaction_id)
        except ValueError:
            abort(404)
        return render_template("transaction_raw.html", transaction=transaction)

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
            filters=TransactionFilters(needs_review=True),
            show_filters=False,
            show_inline_edit=False,
            show_review_actions=True,
            return_to=url_for("review"),
        )

    @app.get("/rules")
    def rules() -> str:
        app_config: AppConfig = app.config["APP_CONFIG"]
        items = list_rules(app_config.database_url) if app_config.database_url else []
        categories = list_category_names(app_config.database_url) if app_config.database_url else []
        return render_template(
            "rules.html",
            items=items,
            categories=categories,
            rule_fields=RULE_FIELDS,
            rule_operators=RULE_OPERATORS,
        )

    @app.post("/rules")
    @require_post_csrf
    def create_rule_route():
        app_config: AppConfig = app.config["APP_CONFIG"]
        if not app_config.database_url:
            abort(400)
        try:
            rule_input = parse_rule_editor_input(request.form.to_dict())
        except ValueError:
            abort(400)
        create_rule_from_input(app_config.database_url, rule_input)
        return redirect(url_for("rules"))

    @app.post("/rules/<int:rule_id>")
    @require_post_csrf
    def update_rule_route(rule_id: int):
        app_config: AppConfig = app.config["APP_CONFIG"]
        if not app_config.database_url:
            abort(400)
        try:
            rule_input = parse_rule_editor_input(request.form.to_dict())
        except ValueError:
            abort(400)
        update_rule_from_input(app_config.database_url, rule_id, rule_input)
        return redirect(url_for("rules"))

    @app.get("/categories")
    def categories() -> str:
        app_config: AppConfig = app.config["APP_CONFIG"]
        rows = load_category_budgets(app_config.database_url) if app_config.database_url else []
        return render_template("categories.html", rows=[row.as_template_context() for row in rows])

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
        correction = ReviewCorrection(
            transaction_id=transaction_id,
            category_name=category_name,
            merchant_name=merchant_name,
            create_alias=request.form.get("create_alias") == "1",
            is_transfer=request.form.get("is_transfer") == "1",
            is_savings=request.form.get("is_savings") == "1",
            is_one_off=request.form.get("is_one_off") == "1",
            is_excluded_from_budget=request.form.get("is_excluded_from_budget") == "1",
        )
        if request.form.get("next") == "apply-similar":
            apply_review_correction_to_similar(app_config.database_url, correction)
            _refresh_forecast(app, app_config)
            return redirect(url_for("review"))
        apply_review_correction(app_config.database_url, correction)
        _refresh_forecast(app, app_config)
        if request.form.get("next") == "rule-preview":
            return redirect(url_for("preview_rule_from_transaction", transaction_id=transaction_id))
        return redirect(url_for("review"))

    @app.post("/transactions/<int:transaction_id>/category")
    @require_post_csrf
    def update_transaction_category(transaction_id: int):
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
                create_alias=request.form.get("create_alias") == "1",
                is_transfer=request.form.get("is_transfer") == "1",
                is_savings=request.form.get("is_savings") == "1",
                is_one_off=request.form.get("is_one_off") == "1",
                is_excluded_from_budget=request.form.get("is_excluded_from_budget") == "1",
            ),
        )
        _refresh_forecast(app, app_config)
        return redirect(_safe_transactions_return(request.form.get("return_to", "")))

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
        return redirect(url_for("rules"))

    @app.post("/rules/<int:rule_id>/backfill")
    @require_post_csrf
    def backfill_rule_route(rule_id: int):
        app_config: AppConfig = app.config["APP_CONFIG"]
        if not app_config.database_url:
            abort(400)
        enqueue_backfill_rule(app_config.database_url, rule_id)
        return redirect(url_for("rules"))

    @app.post("/rules/<int:rule_id>/active")
    @require_post_csrf
    def update_rule_active(rule_id: int):
        app_config: AppConfig = app.config["APP_CONFIG"]
        if not app_config.database_url:
            abort(400)
        set_rule_active(app_config.database_url, rule_id, is_active=request.form.get("is_active") == "true")
        return redirect(url_for("rules"))

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
        generate_budget_export(app_config.database_url, created_by=current_user_email())
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
        forecast_settings_model = (
            load_forecast_settings(app_config.database_url) if app_config.database_url else DEFAULT_FORECAST_SETTINGS
        )
        forecast_settings = forecast_settings_model.as_form_values()
        classification_settings = (
            load_classification_settings(app_config.database_url, app_config).as_form_values()
            if app_config.database_url
            else default_classification_settings(app_config).as_form_values()
        )
        overview = (
            load_settings_overview(app_config.database_url, forecast_settings_model)
            if app_config.database_url
            else DEFAULT_SETTINGS_OVERVIEW
        )
        return render_template(
            "settings.html",
            settings={**forecast_settings, **classification_settings},
            overview=overview,
        )

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
                "salary_day": request.form.get("salary_day", ""),
                "baseline_months": request.form.get("baseline_months", ""),
                "sync_lookback_days": request.form.get("sync_lookback_days", ""),
                "fixed_costs_upcoming": request.form.get("fixed_costs_upcoming", ""),
                "variable_baseline_3m": request.form.get("variable_baseline_3m", ""),
                "variable_baseline_6m": request.form.get("variable_baseline_6m", ""),
            }
        )
        classification_settings = parse_classification_settings(
            {
                "llm_enabled": request.form.get("llm_enabled", ""),
                "llm_confidence_threshold": request.form.get("llm_confidence_threshold", ""),
            },
            app_config,
        )
        save_forecast_settings(app_config.database_url, forecast_settings)
        save_classification_settings(app_config.database_url, classification_settings)
        forecast_as_of = app.config.get("FORECAST_AS_OF")
        update_monthly_forecast(
            app_config.database_url,
            as_of=forecast_as_of if isinstance(forecast_as_of, date) else None,
        )
        return redirect(url_for("dashboard"))

    @app.get("/recurring")
    def recurring() -> str:
        app_config: AppConfig = app.config["APP_CONFIG"]
        forecast_as_of = app.config.get("FORECAST_AS_OF")
        series = (
            list_recurring_series(
                app_config.database_url,
                as_of=forecast_as_of if isinstance(forecast_as_of, date) else None,
            )
            if app_config.database_url
            else []
        )
        return render_template("recurring.html", series=series)

    @app.post("/recurring/<int:series_id>/confirm")
    @require_post_csrf
    def confirm_recurring(series_id: int):
        app_config: AppConfig = app.config["APP_CONFIG"]
        if not app_config.database_url:
            abort(400)
        if not confirm_recurring_series(app_config.database_url, series_id):
            abort(404)
        _refresh_forecast(app, app_config)
        return redirect(url_for("recurring"))

    @app.post("/recurring/<int:series_id>/disable")
    @require_post_csrf
    def disable_recurring(series_id: int):
        app_config: AppConfig = app.config["APP_CONFIG"]
        if not app_config.database_url:
            abort(400)
        if not disable_recurring_series(app_config.database_url, series_id):
            abort(404)
        _refresh_forecast(app, app_config)
        return redirect(url_for("recurring"))


def _refresh_forecast(app: Flask, app_config: AppConfig) -> None:
    forecast_as_of = app.config.get("FORECAST_AS_OF")
    update_monthly_forecast(
        app_config.database_url,
        as_of=forecast_as_of if isinstance(forecast_as_of, date) else None,
    )


def _safe_transactions_return(path: str) -> str:
    if path == "/transactions" or path.startswith("/transactions?"):
        return path
    return url_for("transactions")


def main() -> None:
    app_config = load_config()
    app = create_app(app_config)
    app.run(host=app_config.http_host, port=app_config.http_port)


if __name__ == "__main__":
    main()
