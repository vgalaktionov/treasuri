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
        app = create_app(_test_config(database_url))
        server = make_server("127.0.0.1", port, app)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()

        print(f"E2E_SERVER_READY {json.dumps({'url': f'http://127.0.0.1:{port}'})}", flush=True)
        try:
            while not stop_requested:
                line = sys.stdin.readline()
                if line == "" or line.strip() == "stop":
                    break
        finally:
            _stop_server(server, thread)


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


def _stop_server(server: BaseWSGIServer, thread: threading.Thread) -> None:
    server.shutdown()
    thread.join(timeout=5)


if __name__ == "__main__":
    main()
