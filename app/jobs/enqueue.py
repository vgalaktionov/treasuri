"""PgQueuer enqueue helpers."""

from __future__ import annotations

import asyncio
import json
from collections.abc import Mapping
from typing import Any

import psycopg
from pgqueuer.adapters.drivers.psycopg import PsycopgDriver
from pgqueuer.adapters.persistence.queries import Queries

SYNC_NOW_ENTRYPOINT = "sync-now"
SYNC_ABN_TRANSACTIONS_ENTRYPOINT = "sync_abn_transactions"
NORMALIZE_TRANSACTIONS_ENTRYPOINT = "normalize_transactions"
CLASSIFY_TRANSACTIONS_ENTRYPOINT = "classify_transactions"
DETECT_RECURRING_ENTRYPOINT = "detect_recurring"
UPDATE_MONTHLY_FORECAST_ENTRYPOINT = "update_monthly_forecast"
GENERATE_XLSX_EXPORT_ENTRYPOINT = "generate_xlsx_export"
BACKFILL_RULE_ENTRYPOINT = "backfill_rule"

REQUIRED_JOB_ENTRYPOINTS = (
    SYNC_ABN_TRANSACTIONS_ENTRYPOINT,
    NORMALIZE_TRANSACTIONS_ENTRYPOINT,
    CLASSIFY_TRANSACTIONS_ENTRYPOINT,
    DETECT_RECURRING_ENTRYPOINT,
    UPDATE_MONTHLY_FORECAST_ENTRYPOINT,
    GENERATE_XLSX_EXPORT_ENTRYPOINT,
    BACKFILL_RULE_ENTRYPOINT,
)


async def enqueue_job_async(
    database_url: str,
    entrypoint: str,
    payload: Mapping[str, Any] | None = None,
    *,
    dedupe_key: str | None = None,
) -> int:
    body = json.dumps(payload or {}, sort_keys=True, separators=(",", ":")).encode()
    async with await psycopg.AsyncConnection.connect(database_url, autocommit=True) as connection:
        queries = Queries(PsycopgDriver(connection))
        job_ids = await queries.enqueue(entrypoint, body, dedupe_key=dedupe_key)
    return int(job_ids[0])


def enqueue_job(
    database_url: str,
    entrypoint: str,
    payload: Mapping[str, Any] | None = None,
    *,
    dedupe_key: str | None = None,
) -> int:
    return asyncio.run(enqueue_job_async(database_url, entrypoint, payload, dedupe_key=dedupe_key))


def enqueue_sync_now(database_url: str) -> int:
    return enqueue_job(database_url, SYNC_NOW_ENTRYPOINT, {}, dedupe_key=SYNC_NOW_ENTRYPOINT)


def enqueue_sync_abn_transactions(database_url: str) -> int:
    return enqueue_job(
        database_url,
        SYNC_ABN_TRANSACTIONS_ENTRYPOINT,
        {},
        dedupe_key=SYNC_ABN_TRANSACTIONS_ENTRYPOINT,
    )


def enqueue_normalize_transactions(database_url: str) -> int:
    return enqueue_job(database_url, NORMALIZE_TRANSACTIONS_ENTRYPOINT, {})


def enqueue_classify_transactions(database_url: str) -> int:
    return enqueue_job(database_url, CLASSIFY_TRANSACTIONS_ENTRYPOINT, {})


def enqueue_detect_recurring(database_url: str) -> int:
    return enqueue_job(database_url, DETECT_RECURRING_ENTRYPOINT, {})


def enqueue_update_monthly_forecast(database_url: str) -> int:
    return enqueue_job(
        database_url,
        UPDATE_MONTHLY_FORECAST_ENTRYPOINT,
        {},
        dedupe_key=UPDATE_MONTHLY_FORECAST_ENTRYPOINT,
    )


def enqueue_generate_xlsx_export(
    database_url: str,
    *,
    created_by: str | None = None,
    run_id: int | None = None,
) -> int:
    payload: dict[str, object] = {"created_by": created_by}
    if run_id is not None:
        payload["run_id"] = run_id
    return enqueue_job(
        database_url,
        GENERATE_XLSX_EXPORT_ENTRYPOINT,
        payload,
    )


def enqueue_backfill_rule(database_url: str, rule_id: int) -> int:
    return enqueue_job(
        database_url,
        BACKFILL_RULE_ENTRYPOINT,
        {"rule_id": rule_id},
    )
