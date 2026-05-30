from __future__ import annotations

import re
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]


def read_project_file(path: str) -> str:
    return (PROJECT_ROOT / path).read_text(encoding="utf-8")


def test_dockerfile_builds_single_uv_managed_runtime_image() -> None:
    dockerfile = read_project_file("Dockerfile")

    assert "FROM python:3.12-slim AS runtime" in dockerfile
    assert "COPY --from=ghcr.io/astral-sh/uv:" in dockerfile
    assert "ARG APP_VERSION=0.1.0" in dockerfile
    assert "ARG GIT_SHA=" in dockerfile
    assert 'APP_VERSION="${APP_VERSION}"' in dockerfile
    assert 'GIT_SHA="${GIT_SHA}"' in dockerfile
    assert "uv sync --frozen --no-dev --no-install-project" in dockerfile
    assert 'CMD ["python", "-m", "app.web"]' in dockerfile
    assert "USER treasuri" in dockerfile
    assert "HEALTHCHECK" in dockerfile
    assert "gunicorn" not in dockerfile.lower()


def test_compose_starts_local_runtime_shape_without_caddy_or_frontend_build() -> None:
    compose = read_project_file("compose.yml")

    for service in ("app", "worker", "migrate", "db", "llama"):
        assert re.search(rf"^  {service}:\n", compose, flags=re.MULTILINE), service

    assert "postgres:16-alpine" in compose
    assert "ghcr.io/ggml-org/llama.cpp:server" in compose
    assert "unsloth/gemma-4-E4B-it-GGUF:UD-Q4_K_XL" in compose
    assert "/root/.cache/huggingface" in compose
    assert "/root/.cache/llama.cpp" in compose
    assert "postgresql://treasuri:treasuri@db:5432/treasuri" in compose
    assert '"15432:5432"' in compose
    assert '"5432:5432"' not in compose
    assert 'command: ["python", "-m", "app.web"]' in compose
    assert 'command: ["python", "-m", "app.worker"]' in compose
    assert 'command: ["python", "-m", "app.migrate"]' in compose
    assert "caddy" not in compose.lower()
    assert "npm" not in compose.lower()


def test_gpu_compose_override_enables_llama_gpu_without_requiring_it_by_default() -> None:
    compose = read_project_file("compose.yml")
    gpu_compose = read_project_file("compose.gpu.yml")

    assert "gpus:" not in compose
    assert "ghcr.io/ggml-org/llama.cpp:server-cuda" in gpu_compose
    assert re.search(r"^  llama:\n(?:    .+\n)*    gpus: all\n", gpu_compose, flags=re.MULTILINE)
    assert "--n-gpu-layers" in gpu_compose
    assert '"999"' in gpu_compose


def test_worker_uses_configured_concurrency() -> None:
    worker = read_project_file("app/jobs/worker.py")

    assert "max_concurrent_tasks=config.worker_concurrency" in worker
