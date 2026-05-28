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
DATABASE_URL=postgresql://treasuri:treasuri@127.0.0.1:5432/treasuri uv run python -m app.migrate
DATABASE_URL=postgresql://treasuri:treasuri@127.0.0.1:5432/treasuri uv run python -m app.admin seed-categories
DATABASE_URL=postgresql://treasuri:treasuri@127.0.0.1:5432/treasuri uv run python -m app.admin load-sample-data
uv run python -m app.admin sync-now
uv run pytest
uv run pytest tests/integration
uv run ruff check .
uv run ruff format --check .
uv run ty check
uv run pre-commit run --all-files
```

Install the local git hook once per checkout:

```sh
uv run pre-commit install
```

## Database

Migrations are plain, up-only SQL files in `migrations/`. The migration runner creates `schema_migrations`, applies pending files in filename order, and records each version once.

The first schema slice creates the PRD core tables for accounts, raw and enriched transactions, merchants, aliases, rules, manual overrides, recurring series, monthly forecasts, sync runs, export runs/files, app settings, and seeded categories.

Postgres integration tests use Testcontainers and start a disposable `postgres:16-alpine` container.

`uv run python -m app.admin load-sample-data` loads deterministic fake financial data into Postgres. It is safe to rerun and is intended for local UI development and automated tests only.

The Docker image is intentionally one artifact. Override the Compose command to run the same image as `python -m app.web`, `python -m app.worker`, `python -m app.migrate`, or `python -m app.admin <command>`.

## Development Notes

The dashboard can render deterministic sample values from Postgres after `load-sample-data`, or a no-database fallback for early smoke tests. This proves the runtime shape, mobile layout, local static assets, and OIDC test-profile route protection before real bank sync, review workflows, export, and worker slices are connected.

Do not use real financial details in local fixtures, browser sessions, tests, or screenshots.
