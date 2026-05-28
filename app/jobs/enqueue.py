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
