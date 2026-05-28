"""PgQueuer worker runtime."""

from __future__ import annotations

import asyncio
import signal
from datetime import timedelta

import psycopg
from pgqueuer import PgQueuer
from pgqueuer.domain.models import Job
from pgqueuer.domain.types import QueueExecutionMode

from app.config import AppConfig
from app.jobs.enqueue import SYNC_NOW_ENTRYPOINT
from app.jobs.sync import run_sync_now


def register_entrypoints(pgq: PgQueuer, config: AppConfig) -> None:
    @pgq.entrypoint(SYNC_NOW_ENTRYPOINT)
    async def sync_now(job: Job) -> None:
        _ = job
        result = await asyncio.to_thread(run_sync_now, config)
        print(result.as_summary(), flush=True)


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
