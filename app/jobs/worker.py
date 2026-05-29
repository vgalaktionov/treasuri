"""PgQueuer worker runtime."""

from __future__ import annotations

import asyncio
import json
import signal
from datetime import timedelta

import psycopg
from pgqueuer import PgQueuer
from pgqueuer.domain.models import Job
from pgqueuer.domain.types import QueueExecutionMode

from app.bank.factory import build_bank_adapter
from app.bank.sync import SyncResult, sync_bank_transactions
from app.classify.service import classify_transactions
from app.config import AppConfig
from app.exports.xlsx import generate_budget_export
from app.forecast.service import update_monthly_forecast
from app.jobs.enqueue import (
    BACKFILL_RULE_ENTRYPOINT,
    CLASSIFY_TRANSACTIONS_ENTRYPOINT,
    DETECT_RECURRING_ENTRYPOINT,
    GENERATE_XLSX_EXPORT_ENTRYPOINT,
    NORMALIZE_TRANSACTIONS_ENTRYPOINT,
    SYNC_ABN_TRANSACTIONS_ENTRYPOINT,
    SYNC_NOW_ENTRYPOINT,
    UPDATE_MONTHLY_FORECAST_ENTRYPOINT,
    enqueue_job_async,
)
from app.jobs.sync import run_sync_now
from app.normalize import normalize_raw_transactions
from app.recurring import detect_recurring
from app.rules import backfill_rule as backfill_rule_for_job
from app.sanitize import sanitize_error_message
from app.settings import load_forecast_settings

type JobPayload = dict[str, object]


def register_entrypoints(pgq: PgQueuer, config: AppConfig) -> None:
    @pgq.entrypoint(SYNC_NOW_ENTRYPOINT)
    async def sync_now(job: Job) -> None:
        _log_job_started(SYNC_NOW_ENTRYPOINT, job)
        try:
            result = await asyncio.to_thread(run_sync_now, config)
        except Exception as exc:
            _log_job_failed(SYNC_NOW_ENTRYPOINT, job, exc)
            raise
        _log_job_completed(
            SYNC_NOW_ENTRYPOINT,
            job,
            provider=result.provider,
            new_transaction_count=result.new_transaction_count,
            updated_transaction_count=result.updated_transaction_count,
            skipped_old_transaction_count=result.skipped_old_transaction_count,
            normalized_count=result.normalized_count,
            review_count=result.review_count,
            recurring_detected_count=result.recurring_detected_count,
            forecast_year_month=result.forecast_year_month,
        )

    @pgq.entrypoint(SYNC_ABN_TRANSACTIONS_ENTRYPOINT)
    async def sync_abn_transactions(job: Job) -> None:
        _log_job_started(SYNC_ABN_TRANSACTIONS_ENTRYPOINT, job)
        try:
            sync_result = await asyncio.to_thread(_sync_bank_transactions, config)
        except Exception as exc:
            _log_job_failed(SYNC_ABN_TRANSACTIONS_ENTRYPOINT, job, exc)
            raise
        if sync_result.new_transaction_count > 0 or sync_result.updated_transaction_count > 0:
            await enqueue_job_async(config.database_url, NORMALIZE_TRANSACTIONS_ENTRYPOINT)
        _log_job_completed(
            SYNC_ABN_TRANSACTIONS_ENTRYPOINT,
            job,
            provider=sync_result.provider,
            new_transaction_count=sync_result.new_transaction_count,
            updated_transaction_count=sync_result.updated_transaction_count,
            skipped_old_transaction_count=sync_result.skipped_old_transaction_count,
        )

    @pgq.entrypoint(NORMALIZE_TRANSACTIONS_ENTRYPOINT)
    async def normalize_transactions(job: Job) -> None:
        _log_job_started(NORMALIZE_TRANSACTIONS_ENTRYPOINT, job)
        try:
            normalize_result = await asyncio.to_thread(normalize_raw_transactions, config.database_url)
        except Exception as exc:
            _log_job_failed(NORMALIZE_TRANSACTIONS_ENTRYPOINT, job, exc)
            raise
        if normalize_result.created_count > 0:
            await enqueue_job_async(config.database_url, CLASSIFY_TRANSACTIONS_ENTRYPOINT)
        _log_job_completed(NORMALIZE_TRANSACTIONS_ENTRYPOINT, job, created_count=normalize_result.created_count)

    @pgq.entrypoint(CLASSIFY_TRANSACTIONS_ENTRYPOINT)
    async def classify_transactions_job(job: Job) -> None:
        _log_job_started(CLASSIFY_TRANSACTIONS_ENTRYPOINT, job)
        try:
            classify_result = await asyncio.to_thread(classify_transactions, config.database_url, config)
        except Exception as exc:
            _log_job_failed(CLASSIFY_TRANSACTIONS_ENTRYPOINT, job, exc)
            raise
        await enqueue_job_async(config.database_url, DETECT_RECURRING_ENTRYPOINT)
        _log_job_completed(
            CLASSIFY_TRANSACTIONS_ENTRYPOINT,
            job,
            classified_count=classify_result.classified_count,
            review_count=classify_result.review_count,
            method_counts=classify_result.method_counts,
        )

    @pgq.entrypoint(DETECT_RECURRING_ENTRYPOINT)
    async def detect_recurring_job(job: Job) -> None:
        _log_job_started(DETECT_RECURRING_ENTRYPOINT, job)
        try:
            recurring_result = await asyncio.to_thread(detect_recurring, config.database_url)
        except Exception as exc:
            _log_job_failed(DETECT_RECURRING_ENTRYPOINT, job, exc)
            raise
        await enqueue_job_async(
            config.database_url,
            UPDATE_MONTHLY_FORECAST_ENTRYPOINT,
            dedupe_key=UPDATE_MONTHLY_FORECAST_ENTRYPOINT,
        )
        _log_job_completed(
            DETECT_RECURRING_ENTRYPOINT,
            job,
            detected_count=recurring_result.detected_count,
            linked_transaction_count=recurring_result.linked_transaction_count,
        )

    @pgq.entrypoint(UPDATE_MONTHLY_FORECAST_ENTRYPOINT)
    async def update_monthly_forecast_job(job: Job) -> None:
        _log_job_started(UPDATE_MONTHLY_FORECAST_ENTRYPOINT, job)
        try:
            forecast_result = await asyncio.to_thread(update_monthly_forecast, config.database_url)
        except Exception as exc:
            _log_job_failed(UPDATE_MONTHLY_FORECAST_ENTRYPOINT, job, exc)
            raise
        _log_job_completed(
            UPDATE_MONTHLY_FORECAST_ENTRYPOINT,
            job,
            year_month=forecast_result.year_month,
            safe_to_spend=str(forecast_result.safe_to_spend),
            safe_per_day=str(forecast_result.safe_per_day),
            confidence=forecast_result.confidence,
            review_count=forecast_result.review_count,
        )
        _log_event(
            "forecast_recalculated",
            entrypoint=UPDATE_MONTHLY_FORECAST_ENTRYPOINT,
            job_id=str(job.id),
            year_month=forecast_result.year_month,
        )

    @pgq.entrypoint(GENERATE_XLSX_EXPORT_ENTRYPOINT)
    async def generate_xlsx_export_job(job: Job) -> None:
        _log_job_started(GENERATE_XLSX_EXPORT_ENTRYPOINT, job)
        try:
            created_by = _optional_str_payload(job, "created_by")
            run_id = _optional_int_payload(job, "run_id")
            run_id = await asyncio.to_thread(
                generate_budget_export,
                config.database_url,
                created_by=created_by,
                run_id=run_id,
            )
        except Exception as exc:
            _log_job_failed(GENERATE_XLSX_EXPORT_ENTRYPOINT, job, exc)
            raise
        _log_job_completed(GENERATE_XLSX_EXPORT_ENTRYPOINT, job, export_run_id=run_id)
        _log_event(
            "export_generated",
            entrypoint=GENERATE_XLSX_EXPORT_ENTRYPOINT,
            job_id=str(job.id),
            export_run_id=run_id,
        )

    @pgq.entrypoint(BACKFILL_RULE_ENTRYPOINT)
    async def backfill_rule_job(job: Job) -> None:
        _log_job_started(BACKFILL_RULE_ENTRYPOINT, job)
        try:
            rule_id = _required_int_payload(job, "rule_id")
            result = await asyncio.to_thread(backfill_rule_for_job, config.database_url, rule_id)
        except Exception as exc:
            _log_job_failed(BACKFILL_RULE_ENTRYPOINT, job, exc)
            raise
        await enqueue_job_async(
            config.database_url,
            UPDATE_MONTHLY_FORECAST_ENTRYPOINT,
            dedupe_key=UPDATE_MONTHLY_FORECAST_ENTRYPOINT,
        )
        _log_job_completed(
            BACKFILL_RULE_ENTRYPOINT,
            job,
            rule_id=rule_id,
            updated_count=result.updated_count,
            skipped_manual_count=result.skipped_manual_count,
        )


def _sync_bank_transactions(config: AppConfig) -> SyncResult:
    adapter, account_iban = build_bank_adapter(config)
    sync_settings = load_forecast_settings(config.database_url)
    return sync_bank_transactions(
        config.database_url,
        adapter,
        account_iban=account_iban,
        lookback_days=sync_settings.sync_lookback_days,
    )


def _job_payload(job: Job) -> JobPayload:
    if not job.payload:
        return {}
    payload = json.loads(job.payload.decode())
    if not isinstance(payload, dict):
        raise ValueError("job payload must be a JSON object")
    return payload


def _optional_str_payload(job: Job, key: str) -> str | None:
    value = _job_payload(job).get(key)
    if value is None:
        return None
    if not isinstance(value, str):
        raise ValueError(f"job payload {key} must be a string")
    return value


def _required_int_payload(job: Job, key: str) -> int:
    value = _job_payload(job).get(key)
    if not isinstance(value, int):
        raise ValueError(f"job payload requires integer {key}")
    return value


def _optional_int_payload(job: Job, key: str) -> int | None:
    value = _job_payload(job).get(key)
    if value is None:
        return None
    if not isinstance(value, int):
        raise ValueError(f"job payload {key} must be an integer")
    return value


def _log_job_started(entrypoint: str, job: Job) -> None:
    _log_event("job_started", entrypoint=entrypoint, job_id=str(job.id), attempts=job.attempts)


def _log_job_completed(entrypoint: str, job: Job, **fields: object) -> None:
    _log_event("job_completed", entrypoint=entrypoint, job_id=str(job.id), **fields)


def _log_job_failed(entrypoint: str, job: Job, error: Exception) -> None:
    _log_event(
        "job_failed",
        entrypoint=entrypoint,
        job_id=str(job.id),
        error=_safe_log_error(error),
    )


def _log_event(event: str, **fields: object) -> None:
    print(json.dumps({"event": event, **fields}, sort_keys=True), flush=True)


def _safe_log_error(error: Exception) -> str:
    return sanitize_error_message(error)


def _install_signal_handlers(pgq: PgQueuer) -> None:
    loop = asyncio.get_running_loop()
    for signum in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(signum, pgq.shutdown.set)


async def run_worker(
    config: AppConfig,
    *,
    mode: QueueExecutionMode = QueueExecutionMode.continuous,
    dequeue_timeout: timedelta = timedelta(seconds=5),
) -> None:
    if not config.database_url:
        raise ValueError("DATABASE_URL is required")

    async with await psycopg.AsyncConnection.connect(config.database_url, autocommit=True) as connection:
        pgq = PgQueuer.from_psycopg_connection(connection)
        register_entrypoints(pgq, config)
        if mode == QueueExecutionMode.continuous:
            _install_signal_handlers(pgq)
            print("Treasuri worker ready", flush=True)
        await pgq.run(
            dequeue_timeout=dequeue_timeout,
            batch_size=1,
            mode=mode,
            max_concurrent_tasks=2,
            heartbeat_timeout=timedelta(seconds=30),
        )


def run_until_drained(config: AppConfig) -> None:
    asyncio.run(run_worker(config, mode=QueueExecutionMode.drain, dequeue_timeout=timedelta(seconds=1)))
