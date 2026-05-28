# Repository Guidelines

## Product Direction

Treasuri is a private personal-finance PWA for one primary user. The core product question is: **am I fine, and what can I still spend this month?** Keep the app fast, plain, mobile-friendly, deterministic where possible, and explainable when it predicts or classifies anything.

`PRD.md` is the source of truth for scope and implementation order. Build small vertical slices that leave the app runnable and tested. The first slice should prove the runtime shape with sample data before real ABN AMRO sync or XLSX complexity.

Do not turn this into a SaaS dashboard. MVP non-goals include multi-user flows, local username/password auth, payments, investment tracking, receipt scanning, complex chart dashboards, Caddy/basic-auth, production deployment architecture, and any React/Vue/Svelte/frontend build pipeline.

## Project Structure & Module Organization

Current repo state is minimal:

- `main.py` is the temporary Python entry point.
- `pyproject.toml` and `uv.lock` define the uv-managed Python project.
- `PRD.md` contains the product, architecture, and phased implementation plan.
- `docs/` is reserved for supporting design or operational notes.

Target structure from the PRD:

- `app/` for Flask application code: `web.py`, `worker.py`, `migrate.py`, `admin.py`, `config.py`, `db.py`, `auth.py`.
- `app/templates/` and `app/static/` for server-rendered HTML, HTMX, Pico CSS, PWA assets, and WhiteNoise-packaged static files.
- `app/bank/`, `app/classify/`, `app/forecast/`, `app/exports/`, and `app/jobs/` for clear adapter boundaries.
- `migrations/` for hand-rolled, up-only plain SQL migrations.
- `tests/unit/` and `tests/integration/` for pytest coverage.
- `e2e/` for Puppeteer only; JavaScript must not become a frontend build system.

## Build, Test, and Development Commands

Use `uv` for all Python dependency and command management.

Current commands:

- `uv sync` installs dependencies.
- `uv run python main.py` runs the temporary entry point.

Expected commands as the PRD is implemented:

- `uv run python -m app.web` starts the Flask web process.
- `uv run python -m app.worker` starts the pgqueuer worker.
- `uv run python -m app.migrate` applies plain SQL migrations.
- `uv run python -m app.admin seed-categories` seeds category taxonomy.
- `uv run python -m app.admin sync-now` triggers a one-off sync.
- `uv run pytest` runs Python tests.
- `uv run ruff check .` and `uv run ruff format --check .` run lint and format checks.
- `uv run ty check` runs type checking.
- `docker compose up` starts local app, worker, Postgres, and llama services.
- `npm ci --prefix e2e` and `npm test --prefix e2e` install and run Puppeteer tests.

Local development is Docker Compose. Do not add Caddy to dev. The app should be reachable directly on localhost.

## Architecture Rules

Use Flask, Flask-OIDC, PostgreSQL, plain psycopg, hand-rolled SQL migrations, pgqueuer, server-rendered HTML, HTMX, Pico CSS, WhiteNoise for packaged static files, and server-side XLSX generation.

Do not introduce an ORM, Poetry, pip-tools, Black, standalone isort, mypy, tox, nox, a frontend bundler, or a client-side app framework.

The packaged artifact is one 12-factor-style Docker/OCI image published to GHCR. The same image must support `web`, `worker`, `migrate`, and admin commands. Configuration comes from environment variables, secrets must not be baked into the image, logs go to stdout/stderr, and durable data belongs in Postgres.

Generated XLSX files must be stored as Postgres `bytea` blobs and streamed from Postgres on download. Do not rely on durable container filesystem state.

## Coding Style & Naming Conventions

Use Python 3.12 or newer. Use 4-space indentation, `snake_case` for modules/functions/variables, and `PascalCase` for classes. Prefer explicit SQL, typed signatures for non-trivial code, and small functions with behavior-focused names.

Ruff owns linting and formatting once configured. ty owns type checking. Keep adapter boundaries explicit for bank providers, classification providers, forecast calculation, export generation, background jobs, auth/user context, and the LLM runtime client.

## Testing Guidelines

Testing starts at Phase 0. Every implementation phase should add or update tests.

Required layers include unit tests, migration tests, Postgres integration tests, job tests, classification pipeline tests, forecast calculation tests, XLSX export tests, Flask route tests, Puppeteer E2E tests, and Docker image command smoke tests.

Coverage priorities:

- forecast formula and safe-to-spend math
- classification priority order
- manual overrides and rule backfills
- idempotent imports
- export blob storage and download
- route auth and allowed-user behavior
- dashboard, review inbox, transactions, rule preview, export, and mobile E2E flows

Use deterministic sample data. Do not use real financial details in tests, screenshots, browser sessions, or fixtures.

## Auth, Security, and Privacy

Use Flask-OIDC for normal runtime auth. Protect app routes by default; only health checks and static assets should be explicitly public. Dev and test use `OIDC_ENABLED=false` plus `OIDC_TESTING_PROFILE_JSON`, and that profile must still pass allowed-email logic.

Do not add local password auth, public registration, Caddy basic auth, or multi-user product behavior. Store secrets in environment variables or mounted secret files. Do not log OIDC tokens, bank credentials, or full raw bank payloads at info level. Use CSRF protection for state-changing forms.

Chrome DevTools MCP may be used only with fake/sample data. Never expose real financial data to MCP browser inspection.

## LLM Classification Rules

The LLM is a fallback classifier, not the primary categorizer. Use deterministic methods first: manual overrides, rules, merchant aliases, and historical similarity.

The local classifier should talk to an OpenAI-compatible llama endpoint using `unsloth/gemma-4-E4B-it-GGUF`, defaulting to `unsloth/gemma-4-E4B-it-GGUF:UD-Q4_K_XL`. Use temperature `0`, validate strict JSON, store model ref and prompt version, and make LLM failures non-fatal. The model may suggest categories or merchants, but must not create categories or rules automatically.

## UI and Agent Workflow

For UI work, inspect the running app in Chrome with Chrome DevTools MCP. Use screenshots, console logs, network inspection, and DOM inspection before marking UI work complete. Static template inspection alone is not enough.

Puppeteer remains the automated acceptance layer. UI work is incomplete without route, integration, or E2E coverage appropriate to the behavior changed.

The UI should prioritize the above-the-fold answer: safe to spend, safe per day, projected savings, target savings, confidence, pace, unusual category spend, and transactions needing review. Never show a magic number without an accessible explanation.

## Commit & Pull Request Guidelines

Use Conventional Commits:

- `feat: add Flask app factory`
- `fix(auth): enforce allowed email in test profile`
- `test: cover idempotent transaction import`
- `docs(prd): clarify first vertical slice`

Pull requests should include a concise description, linked issue or PRD task, test results, and screenshots or terminal output for user-visible behavior. For UI changes, include evidence from Puppeteer or browser inspection with sample data.
