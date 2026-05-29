# Treasuri

Treasuri is a private personal-finance PWA for answering one daily question: am I fine, and what can I still spend this month?

The implementation follows `PRD.md`: Flask, server-rendered HTML, HTMX, Pico CSS, PostgreSQL with plain psycopg, hand-rolled SQL migrations, pgqueuer workers, Flask-OIDC auth, and deterministic sample data before real ABN AMRO sync.

## Local Setup

Install dependencies:

```sh
uv sync
```

Run the full local stack:

```sh
docker compose up --build
```

The Compose stack starts the web process, worker process, Postgres, one-shot migrations, and a local llama.cpp OpenAI-compatible server for the configured Gemma GGUF model. Then open `http://127.0.0.1:5000`.

If the machine has a Docker-visible GPU, run the llama service with GPU access:

```sh
docker compose -f compose.yml -f compose.gpu.yml up --build
```

The GPU override grants the llama container GPU access and passes `--n-gpu-layers 999`, which asks llama.cpp to offload as many layers as fit in VRAM. The llama logs should mention layers being offloaded to confirm the GPU path is active.

Run the web process with the development OIDC test profile:

```sh
OIDC_ENABLED=false \
OIDC_TESTING_PROFILE_JSON='{"sub":"dev-user","nickname":"dev-user","email":"dev-user@example.test","groups":["finance-app"]}' \
ALLOWED_EMAILS=dev-user@example.test \
uv run python -m app.web
```

Then open `http://127.0.0.1:5000`.

## Current Commands

```sh
uv run python -m app.web
DATABASE_URL=postgresql://treasuri:treasuri@127.0.0.1:5432/treasuri uv run python -m app.worker
docker compose up --build
docker compose -f compose.yml -f compose.gpu.yml up --build
DATABASE_URL=postgresql://treasuri:treasuri@127.0.0.1:5432/treasuri uv run python -m app.migrate
DATABASE_URL=postgresql://treasuri:treasuri@127.0.0.1:5432/treasuri uv run python -m app.admin seed-categories
DATABASE_URL=postgresql://treasuri:treasuri@127.0.0.1:5432/treasuri uv run python -m app.admin load-sample-data
uv run python -m app.admin sync-now
uv run python -m app.admin enqueue-sync
uv run pytest
uv run pytest tests/integration
TREASURI_LLM_SMOKE=1 uv run pytest tests/integration/test_llm_smoke.py
uv run ruff check .
uv run ruff format --check .
uv run ty check
uv run pre-commit run --all-files
npm ci --prefix e2e
npm test --prefix e2e
```

Install the local git hook once per checkout:

```sh
uv run pre-commit install
```

## Database

Migrations are plain, up-only SQL files in `migrations/`. The migration runner creates `schema_migrations`, applies pending files in filename order, and records each version once.

The first schema slice creates the PRD core tables for accounts, raw and enriched transactions, merchants, aliases, rules, manual overrides, recurring series, monthly forecasts, sync runs, export runs/files, app settings, and seeded categories.

Postgres integration tests use Testcontainers and start a disposable `postgres:16-alpine` container.

Puppeteer E2E tests also use deterministic sample data. The test harness starts a disposable Postgres container, applies migrations, loads sample data, and launches the Flask app before opening Chrome.
If a Puppeteer assertion fails, the harness writes screenshots and the thrown stack to `E2E_ARTIFACT_DIR`, or `/tmp/treasuri-e2e-artifacts` when the variable is not set.

`uv run python -m app.admin load-sample-data` loads deterministic fake financial data into Postgres. It is safe to rerun and is intended for local UI development and automated tests only.

`uv run python -m app.admin enqueue-sync` enqueues the `sync_abn_transactions` worker chain. `sync-now` remains a foreground one-shot command for local debugging.

The Docker image is intentionally one artifact. Override the Compose command to run the same image as `python -m app.web`, `python -m app.worker`, `python -m app.migrate`, or `python -m app.admin <command>`.

Bank sync defaults to the deterministic fake provider. To use ABN AMRO, set `BANK_PROVIDER=abn`, `ABN_ACCOUNT_IBAN`, `ABN_CARD_NUMBER`, and `ABN_SOFT_TOKEN`; the app keeps `abna` usage inside the bank adapter boundary.

Classification runs deterministic methods first. If `LLM_ENABLED=true`, uncategorized transactions can receive a local llama suggestion from the OpenAI-compatible endpoint, but they still stay in review until confirmed.

## OCI Image

CI builds the Docker image after formatting, lint, type, Python, and Puppeteer checks pass. Pushes to `main` and `v*` tags publish to GHCR with a git SHA tag; `main` also gets `latest`.

Pull an image:

```sh
docker pull ghcr.io/<owner>/treasuri:sha-<git-sha>
```

Run one-off process types by overriding the command:

```sh
docker run --rm --env-file .env ghcr.io/<owner>/treasuri:sha-<git-sha> python -m app.migrate
docker run --rm --env-file .env ghcr.io/<owner>/treasuri:sha-<git-sha> python -m app.web
docker run --rm --env-file .env ghcr.io/<owner>/treasuri:sha-<git-sha> python -m app.worker
docker run --rm --env-file .env ghcr.io/<owner>/treasuri:sha-<git-sha> python -m app.admin sync-now
```

Required runtime environment:

```text
SECRET_KEY
DATABASE_URL
ALLOWED_EMAILS
OIDC_ENABLED
OIDC_CLIENT_SECRETS when OIDC_ENABLED=true
OIDC_ID_TOKEN_COOKIE_SECURE
OIDC_OPENID_REALM
OIDC_SCOPES
SESSION_LIFETIME_MINUTES
```

Common optional environment:

```text
HTTP_HOST
HTTP_PORT
APP_VERSION
GIT_SHA
WORKER_CONCURRENCY
SYNC_LOOKBACK_DAYS
EXPORT_RETENTION_DAYS
LLM_ENABLED
LLM_BASE_URL
LLM_MODEL
LLM_TIMEOUT_SECONDS
LLM_CLASSIFICATION_TEMPERATURE
LLM_CLASSIFICATION_CONFIDENCE_THRESHOLD
BANK_PROVIDER
ABN_ACCOUNT_IBAN
ABN_CARD_NUMBER
ABN_SOFT_TOKEN
```

## Development Notes

The dashboard can render deterministic sample values from Postgres after `load-sample-data`, or a no-database fallback for early smoke tests. This proves the runtime shape, mobile layout, local static assets, and OIDC test-profile route protection before real bank sync, review workflows, export, and worker slices are connected.

`tests/integration/test_llm_smoke.py` is skipped by default. Run it only when the local llama service is up on `LLM_BASE_URL`, usually after starting Docker Compose.

Do not use real financial details in local fixtures, browser sessions, tests, or screenshots.
