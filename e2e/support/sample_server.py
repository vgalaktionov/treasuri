"""Start a sample-data app server for Puppeteer tests."""

from __future__ import annotations

import json
import signal
import socket
import sys
import threading

from testcontainers.postgres import PostgresContainer
from werkzeug.serving import BaseWSGIServer, make_server

from app.config import AppConfig
from app.jobs.worker import run_until_drained
from app.migrate import run_migrations
from app.sample_data import load_sample_data
from app.web import create_app


def main() -> None:
    stop_requested = False

    def request_stop(_signum: int, _frame: object) -> None:
        nonlocal stop_requested
        stop_requested = True

    signal.signal(signal.SIGINT, request_stop)
    signal.signal(signal.SIGTERM, request_stop)

    with PostgresContainer(
        image="postgres:16-alpine",
        username="treasuri",
        password="treasuri",
        dbname="treasuri",
        driver=None,
    ) as postgres:
        database_url = postgres.get_connection_url(driver=None)
        run_migrations(database_url)
        load_sample_data(database_url)

        port = _find_free_port()
        config = _test_config(database_url)
        app = create_app(config)
        server = make_server("127.0.0.1", port, app)
        server_thread = threading.Thread(target=server.serve_forever, daemon=True)
        stop_worker = threading.Event()
        worker_thread = threading.Thread(target=_drain_worker_until_stopped, args=(config, stop_worker), daemon=True)
        server_thread.start()
        worker_thread.start()

        print(f"E2E_SERVER_READY {json.dumps({'url': f'http://127.0.0.1:{port}'})}", flush=True)
        try:
            while not stop_requested:
                line = sys.stdin.readline()
                if line == "" or line.strip() == "stop":
                    break
        finally:
            _stop_worker(stop_worker, worker_thread)
            _stop_server(server, server_thread)


def _test_config(database_url: str) -> AppConfig:
    return AppConfig(
        app_env="test",
        secret_key="e2e-secret",
        database_url=database_url,
        allowed_emails=("dev-user@example.test",),
        oidc_enabled=False,
        oidc_testing_profile={
            "sub": "dev-user",
            "nickname": "dev-user",
            "email": "dev-user@example.test",
            "groups": ["finance-app"],
        },
        oidc_cookie_secure=False,
        llm_enabled=False,
        bank_provider="fake",
    )


def _find_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def _drain_worker_until_stopped(config: AppConfig, stop_event: threading.Event) -> None:
    while not stop_event.is_set():
        run_until_drained(config)
        stop_event.wait(0.25)


def _stop_worker(stop_event: threading.Event, thread: threading.Thread) -> None:
    stop_event.set()
    thread.join(timeout=5)


def _stop_server(server: BaseWSGIServer, thread: threading.Thread) -> None:
    server.shutdown()
    thread.join(timeout=5)


if __name__ == "__main__":
    main()
