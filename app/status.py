"""Status page read model."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from urllib.parse import urlsplit, urlunsplit

import psycopg

from app.config import AppConfig
from app.sanitize import sanitize_error_message


@dataclass(frozen=True)
class StatusRow:
    label: str
    value: str
    detail: str | None = None


@dataclass(frozen=True)
class StatusSection:
    title: str
    rows: list[StatusRow]


def load_status_sections(config: AppConfig) -> list[StatusSection]:
    runtime_section = StatusSection(
        title="Runtime",
        rows=[
            StatusRow("App version", config.app_version),
            StatusRow("Git SHA", _short_sha(config.git_sha)),
            StatusRow("Environment", config.app_env),
            StatusRow("OIDC", "enabled" if config.oidc_enabled else "disabled"),
            StatusRow("OIDC realm", config.oidc_openid_realm),
            StatusRow("OIDC client secrets", _configured(config.oidc_client_secrets)),
            StatusRow("Allowed emails", f"{len(config.allowed_emails)} configured"),
            StatusRow("Worker concurrency", str(config.worker_concurrency)),
            StatusRow("Bank provider", config.bank_provider),
            StatusRow("ABN account", _configured(config.abn_account_iban)),
            StatusRow("ABN card", _configured(config.abn_card_number)),
            StatusRow("ABN token", _configured(config.abn_soft_token)),
            StatusRow("LLM", "enabled" if config.llm_enabled else "disabled"),
            StatusRow("LLM endpoint", _redact_url(config.llm_base_url)),
            StatusRow("LLM model", config.llm_model),
        ],
    )

    if not config.database_url:
        return [
            StatusSection(
                "Database", [StatusRow("Connection", "not configured", "Set DATABASE_URL to inspect runtime state.")]
            ),
            runtime_section,
        ]

    try:
        return [
            *_load_database_sections(config.database_url),
            runtime_section,
        ]
    except psycopg.Error as exc:
        return [
            StatusSection("Database", [StatusRow("Connection", "error", sanitize_error_message(exc))]),
            runtime_section,
        ]


def _load_database_sections(database_url: str) -> list[StatusSection]:
    with psycopg.connect(database_url) as connection:
        migration_version = connection.execute(
            "SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1"
        ).fetchone()
        sync_run = connection.execute(
            """
            SELECT provider, status, finished_at, new_transaction_count, updated_transaction_count, error_message
            FROM sync_runs
            ORDER BY started_at DESC, id DESC
            LIMIT 1
            """
        ).fetchone()
        export_run = connection.execute(
            """
            SELECT export_runs.status, export_files.filename, export_runs.finished_at, export_runs.error_message
            FROM export_runs
            LEFT JOIN export_files ON export_files.export_run_id = export_runs.id
            ORDER BY export_runs.id DESC
            LIMIT 1
            """
        ).fetchone()
        job_counts = connection.execute(
            """
            SELECT status::text, count(*)
            FROM pgqueuer
            GROUP BY status
            ORDER BY status::text
            """
        ).fetchall()
        job_log = connection.execute(
            """
            SELECT status::text, entrypoint, created
            FROM pgqueuer_log
            ORDER BY created DESC, id DESC
            LIMIT 1
            """
        ).fetchone()
        forecast = connection.execute(
            """
            SELECT year_month, updated_at, safe_to_spend, confidence
            FROM monthly_forecasts
            ORDER BY updated_at DESC, id DESC
            LIMIT 1
            """
        ).fetchone()

    return [
        StatusSection("Database", [StatusRow("Migration version", _optional_text(migration_version, 0, "none"))]),
        StatusSection("Sync", [_sync_row(sync_run)]),
        StatusSection("Forecast", [_forecast_row(forecast)]),
        StatusSection("Worker", [_job_count_row(job_counts), _job_log_row(job_log)]),
        StatusSection("Exports", [_export_row(export_run)]),
    ]


def _sync_row(row: tuple[object, ...] | None) -> StatusRow:
    if row is None:
        return StatusRow("Last sync", "none")
    provider = str(row[0])
    status = str(row[1])
    finished = _format_datetime(row[2])
    counts = f"{_read_int(row[3])} new, {_read_int(row[4])} updated"
    error = _optional_text(row, 5)
    detail = f"{provider}, {counts}"
    if finished:
        detail = f"{detail}, finished {finished}"
    if error:
        detail = f"{detail}, error: {error}"
    return StatusRow("Last sync", status, detail)


def _job_count_row(rows: list[tuple[object, ...]]) -> StatusRow:
    if not rows:
        return StatusRow("Queued jobs", "0")
    counts = ", ".join(f"{row[0]} {row[1]}" for row in rows)
    queued = sum(_read_int(row[1]) for row in rows if row[0] == "queued")
    return StatusRow("Queued jobs", str(queued), counts)


def _forecast_row(row: tuple[object, ...] | None) -> StatusRow:
    if row is None:
        return StatusRow("Last forecast update", "none")
    updated = _format_datetime(row[1])
    detail_parts = [
        f"safe to spend {row[2]}",
        f"confidence {row[3]}",
        f"updated {updated}" if updated else None,
    ]
    return StatusRow("Last forecast update", str(row[0]), ", ".join(part for part in detail_parts if part))


def _job_log_row(row: tuple[object, ...] | None) -> StatusRow:
    if row is None:
        return StatusRow("Latest worker result", "none")
    created = _format_datetime(row[2])
    detail = str(row[1])
    if created:
        detail = f"{detail}, {created}"
    return StatusRow("Latest worker result", str(row[0]), detail)


def _export_row(row: tuple[object, ...] | None) -> StatusRow:
    if row is None:
        return StatusRow("Latest export", "none")
    status = str(row[0])
    filename = _optional_text(row, 1)
    finished = _format_datetime(row[2])
    error = _optional_text(row, 3)
    detail_parts = [
        part
        for part in (filename, f"finished {finished}" if finished else None, f"error: {error}" if error else None)
        if part
    ]
    return StatusRow("Latest export", status, ", ".join(detail_parts) if detail_parts else None)


def _configured(value: str) -> str:
    return "configured" if value else "missing"


def _short_sha(value: str) -> str:
    return value[:12] if value else "unavailable"


def _redact_url(value: str) -> str:
    if not value:
        return "missing"
    parsed = urlsplit(value)
    if not parsed.scheme or not parsed.netloc:
        return "configured"
    host = parsed.hostname or ""
    port = f":{parsed.port}" if parsed.port is not None else ""
    return urlunsplit((parsed.scheme, f"{host}{port}", parsed.path, "", ""))


def _optional_text(row: tuple[object, ...] | None, index: int, default: str = "") -> str:
    if row is None or row[index] is None:
        return default
    return str(row[index])


def _read_int(value: object) -> int:
    if not isinstance(value, int):
        raise RuntimeError(f"expected integer, got {type(value).__name__}")
    return value


def _format_datetime(value: object) -> str:
    if not isinstance(value, datetime):
        return ""
    return value.strftime("%Y-%m-%d %H:%M")
