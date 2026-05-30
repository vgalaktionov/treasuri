# Treasuri

Treasuri is a private personal-finance PWA for answering one daily question: am I fine, and what can I still spend this month?

## Rewrite Status

`PRD.v2.md` is the current source of truth. The project is being rewritten from the v1 Python/Flask prototype to a Node.js/TypeScript, React, Tailwind, PostgreSQL, `pg-boss`, Zod, Biome, Husky, Vitest, and Playwright stack.

The previous Python implementation remains in the tree only as prototype reference until each PRD v2 slice replaces it. Do not use the old Flask/HTMX code as the architecture target.

## Current Slice

Implementation follows the vertical slices in `PRD.v2.md`.

Slice 0 aligns repository guidance:

- `AGENTS.md` points agents at the v2 stack.
- `PRD.v2.md` supersedes the deleted v1 PRD.
- Future slices must stay runnable, tested, and committed one slice at a time.

## Target Development Contract

The v2 app must keep the infrastructure boundary from the prototype:

- Docker Compose for local development.
- App, worker, Postgres, migration/admin support, and llama runtime in local Compose.
- Postgres exposed on a non-default host port, currently `127.0.0.1:15432`.
- No Caddy in local development.
- One GHCR-published OCI image that supports `web`, `worker`, `migrate`, and admin commands.

Testing requirements are intentionally strict:

- Vitest unit tests.
- Vitest integration tests with Testcontainers Postgres.
- Playwright E2E tests for user-visible flows.
- Migration tests from a clean database.
- Job tests for `pg-boss`.
- Docker image command smoke tests.
- Real local Docker Compose verification after each vertical slice.

Use deterministic sample data only. Do not use real financial details in fixtures, screenshots, browser sessions, tests, or Chrome DevTools MCP sessions.

## Legacy Prototype

Until the relevant v2 slices replace it, some legacy Python files, migrations, tests, and Compose services may still exist. They are not the desired final architecture.

When changing behavior, prefer implementing the next PRD v2 slice instead of extending the legacy stack.
