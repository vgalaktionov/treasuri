from __future__ import annotations

import os
import subprocess
import time
from collections.abc import Iterator
from pathlib import Path
from urllib.parse import urlsplit
from urllib.request import urlopen
from uuid import uuid4

import pytest
from testcontainers.postgres import PostgresContainer

PROJECT_ROOT = Path(__file__).resolve().parents[2]

pytestmark = pytest.mark.skipif(
    os.environ.get("TREASURI_DOCKER_SMOKE") != "1",
    reason="set TREASURI_DOCKER_SMOKE=1 to build and smoke-test the Docker image",
)


@pytest.fixture(scope="module")
def smoke_image() -> Iterator[str]:
    _require_docker()
    tag = f"treasuri:smoke-{uuid4().hex}"
    _run(["docker", "build", "-t", tag, "."], timeout=240)
    try:
        yield tag
    finally:
        _run(["docker", "rmi", "-f", tag], timeout=60, check=False)


def test_image_runs_migrate_web_and_worker_commands(smoke_image: str) -> None:
    with PostgresContainer(
        image="postgres:16-alpine",
        username="treasuri",
        password="treasuri",
        dbname="treasuri",
        driver=None,
    ) as postgres:
        database_url = _container_database_url(postgres.get_connection_url(driver=None))
        base_run = _docker_run_base(database_url)

        migrate = _run(
            [*base_run, "--rm", smoke_image, "python", "-m", "app.migrate"],
            timeout=60,
        )
        assert "Applied migrations:" in migrate.stdout

        web_name = f"treasuri-web-smoke-{uuid4().hex}"
        worker_name = f"treasuri-worker-smoke-{uuid4().hex}"
        try:
            _run(
                [
                    *base_run,
                    "--detach",
                    "--rm",
                    "--name",
                    web_name,
                    "-p",
                    "127.0.0.1::5000",
                    smoke_image,
                    "python",
                    "-m",
                    "app.web",
                ],
                timeout=30,
            )
            web_port = _published_port(web_name, "5000/tcp")
            assert _eventually_reads(f"http://127.0.0.1:{web_port}/healthz") == b'{"status":"ok"}\n'
            manifest = _eventually_reads(f"http://127.0.0.1:{web_port}/static/site.webmanifest")
            assert b'"name": "Treasuri"' in manifest

            _run(
                [
                    *base_run,
                    "--detach",
                    "--rm",
                    "--name",
                    worker_name,
                    smoke_image,
                    "python",
                    "-m",
                    "app.worker",
                ],
                timeout=30,
            )
            time.sleep(3)
            assert _container_is_running(worker_name), _container_logs(worker_name)
        finally:
            _stop_container(worker_name)
            _stop_container(web_name)


def _docker_run_base(database_url: str) -> list[str]:
    return [
        "docker",
        "run",
        "--add-host",
        "host.docker.internal:host-gateway",
        "-e",
        "APP_ENV=production",
        "-e",
        "SECRET_KEY=smoke-secret",
        "-e",
        f"DATABASE_URL={database_url}",
        "-e",
        "HTTP_HOST=0.0.0.0",
        "-e",
        "HTTP_PORT=5000",
        "-e",
        "OIDC_ENABLED=false",
        "-e",
        'OIDC_TESTING_PROFILE_JSON={"sub":"smoke","email":"dev-user@example.test"}',
        "-e",
        "ALLOWED_EMAILS=dev-user@example.test",
        "-e",
        "BANK_PROVIDER=fake",
    ]


def _container_database_url(host_database_url: str) -> str:
    parsed = urlsplit(host_database_url)
    if parsed.port is None:
        raise AssertionError(f"Postgres URL has no port: {host_database_url}")
    return f"postgresql://treasuri:treasuri@host.docker.internal:{parsed.port}{parsed.path}"


def _published_port(container_name: str, private_port: str) -> int:
    output = _run(["docker", "port", container_name, private_port], timeout=10).stdout.strip()
    if not output:
        raise AssertionError(f"{container_name} has no published {private_port} port")
    return int(output.rsplit(":", maxsplit=1)[-1])


def _eventually_reads(url: str, *, attempts: int = 40) -> bytes:
    for _attempt in range(attempts):
        try:
            with urlopen(url, timeout=2) as response:
                return response.read()
        except OSError:
            time.sleep(0.25)
    raise AssertionError(f"URL did not become readable: {url}")


def _container_is_running(container_name: str) -> bool:
    result = _run(
        ["docker", "inspect", "-f", "{{.State.Running}}", container_name],
        timeout=10,
        check=False,
    )
    return result.returncode == 0 and result.stdout.strip() == "true"


def _container_logs(container_name: str) -> str:
    result = _run(["docker", "logs", container_name], timeout=10, check=False)
    return result.stdout + result.stderr


def _stop_container(container_name: str) -> None:
    _run(["docker", "stop", container_name], timeout=30, check=False)


def _require_docker() -> None:
    result = _run(["docker", "version"], timeout=10, check=False)
    if result.returncode != 0:
        pytest.skip("Docker is not available")


def _run(args: list[str], *, timeout: int, check: bool = True) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(
        args,
        cwd=PROJECT_ROOT,
        capture_output=True,
        check=False,
        text=True,
        timeout=timeout,
    )
    if check and result.returncode != 0:
        raise AssertionError(
            f"Command failed with exit {result.returncode}: {' '.join(args)}\n"
            f"stdout:\n{result.stdout}\n"
            f"stderr:\n{result.stderr}"
        )
    return result
