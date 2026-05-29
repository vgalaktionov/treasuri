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

type JobPayload = dict[str, object]


def register_entrypoints(pgq: PgQueuer, config: AppConfig) -> None:
    @pgq.entrypoint(SYNC_NOW_ENTRYPOINT)
    async def sync_now(job: Job) -> None:
        _ = job
        result = await asyncio.to_thread(run_sync_now, config)
        print(result.as_summary(), flush=True)

    @pgq.entrypoint(SYNC_ABN_TRANSACTIONS_ENTRYPOINT)
    async def sync_abn_transactions(job: Job) -> None:
        _ = job
        sync_result = await asyncio.to_thread(_sync_bank_transactions, config)
        if sync_result.new_transaction_count > 0 or sync_result.updated_transaction_count > 0:
            await enqueue_job_async(config.database_url, NORMALIZE_TRANSACTIONS_ENTRYPOINT)
        print(
            f"{SYNC_ABN_TRANSACTIONS_ENTRYPOINT}: {sync_result.new_transaction_count} new, "
            f"{sync_result.updated_transaction_count} updated",
            flush=True,
        )

    @pgq.entrypoint(NORMALIZE_TRANSACTIONS_ENTRYPOINT)
    async def normalize_transactions(job: Job) -> None:
        _ = job
        normalize_result = await asyncio.to_thread(normalize_raw_transactions, config.database_url)
        if normalize_result.created_count > 0:
            await enqueue_job_async(config.database_url, CLASSIFY_TRANSACTIONS_ENTRYPOINT)
        print(f"{NORMALIZE_TRANSACTIONS_ENTRYPOINT}: {normalize_result.created_count} created", flush=True)

    @pgq.entrypoint(CLASSIFY_TRANSACTIONS_ENTRYPOINT)
    async def classify_transactions_job(job: Job) -> None:
        _ = job
        classify_result = await asyncio.to_thread(classify_transactions, config.database_url, config)
        await enqueue_job_async(config.database_url, DETECT_RECURRING_ENTRYPOINT)
        print(
            f"{CLASSIFY_TRANSACTIONS_ENTRYPOINT}: {classify_result.classified_count} classified, "
            f"{classify_result.review_count} review",
            flush=True,
        )

    @pgq.entrypoint(DETECT_RECURRING_ENTRYPOINT)
    async def detect_recurring_job(job: Job) -> None:
        _ = job
        recurring_result = await asyncio.to_thread(detect_recurring, config.database_url)
        await enqueue_job_async(
            config.database_url,
            UPDATE_MONTHLY_FORECAST_ENTRYPOINT,
            dedupe_key=UPDATE_MONTHLY_FORECAST_ENTRYPOINT,
        )
        print(f"{DETECT_RECURRING_ENTRYPOINT}: {recurring_result.detected_count} detected", flush=True)

    @pgq.entrypoint(UPDATE_MONTHLY_FORECAST_ENTRYPOINT)
    async def update_monthly_forecast_job(job: Job) -> None:
        _ = job
        forecast_result = await asyncio.to_thread(update_monthly_forecast, config.database_url)
        print(f"{UPDATE_MONTHLY_FORECAST_ENTRYPOINT}: {forecast_result.year_month}", flush=True)

    @pgq.entrypoint(GENERATE_XLSX_EXPORT_ENTRYPOINT)
    async def generate_xlsx_export_job(job: Job) -> None:
        created_by = _optional_str_payload(job, "created_by")
        run_id = _optional_int_payload(job, "run_id")
        run_id = await asyncio.to_thread(
            generate_budget_export,
            config.database_url,
            created_by=created_by,
            run_id=run_id,
        )
        print(f"{GENERATE_XLSX_EXPORT_ENTRYPOINT}: run {run_id}", flush=True)

    @pgq.entrypoint(BACKFILL_RULE_ENTRYPOINT)
    async def backfill_rule_job(job: Job) -> None:
        rule_id = _required_int_payload(job, "rule_id")
        result = await asyncio.to_thread(backfill_rule_for_job, config.database_url, rule_id)
        await enqueue_job_async(
            config.database_url,
            UPDATE_MONTHLY_FORECAST_ENTRYPOINT,
            dedupe_key=UPDATE_MONTHLY_FORECAST_ENTRYPOINT,
        )
        print(
            f"{BACKFILL_RULE_ENTRYPOINT}: {result.updated_count} updated, {result.skipped_manual_count} skipped",
            flush=True,
        )


def _sync_bank_transactions(config: AppConfig) -> SyncResult:
    adapter, account_iban = build_bank_adapter(config)
    return sync_bank_transactions(config.database_url, adapter, account_iban=account_iban)


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
