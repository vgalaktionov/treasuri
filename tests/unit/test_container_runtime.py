from __future__ import annotations

import re
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]


def read_project_file(path: str) -> str:
    return (PROJECT_ROOT / path).read_text(encoding="utf-8")


def test_dockerfile_builds_single_node_runtime_image() -> None:
    dockerfile = read_project_file("Dockerfile")

    assert "FROM node:22-slim AS runtime" in dockerfile
    assert "ARG APP_VERSION=0.2.0" in dockerfile
    assert "ARG GIT_SHA=" in dockerfile
    assert 'APP_VERSION="${APP_VERSION}"' in dockerfile
    assert 'GIT_SHA="${GIT_SHA}"' in dockerfile
    assert "HUSKY=0 npm ci" in dockerfile
    assert "npm run build" in dockerfile
    assert 'CMD ["npm", "run", "start"]' in dockerfile
    assert "USER node" in dockerfile
    assert "HEALTHCHECK" in dockerfile
    assert "python:" not in dockerfile.lower()


def test_compose_starts_local_runtime_shape_without_caddy() -> None:
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
    assert 'command: ["npm", "run", "start"]' in compose
    assert 'command: ["npm", "run", "worker"]' in compose
    assert 'command: ["npm", "run", "migrate"]' in compose
    assert "caddy" not in compose.lower()
    assert "python" not in compose.lower()


def test_gpu_compose_override_enables_llama_gpu_without_requiring_it_by_default() -> None:
    compose = read_project_file("compose.yml")
    gpu_compose = read_project_file("compose.gpu.yml")

    assert "gpus:" not in compose
    assert "ghcr.io/ggml-org/llama.cpp:server-cuda" in gpu_compose
    assert re.search(r"^  llama:\n(?:    .+\n)*    gpus: all\n", gpu_compose, flags=re.MULTILINE)
    assert "--n-gpu-layers" in gpu_compose
    assert '"999"' in gpu_compose


def test_package_exposes_node_process_commands() -> None:
    package_json = read_project_file("package.json")

    assert '"start": "tsx src/server/index.ts"' in package_json
    assert '"worker": "tsx src/server/worker.ts"' in package_json
    assert '"migrate": "tsx src/server/migrate.ts"' in package_json
