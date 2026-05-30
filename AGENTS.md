# Repository Guidelines

## Product Direction

Treasuri is a private personal-finance PWA for one primary user. The core product question is: **am I fine, and what can I still spend this month?**

`PRD.v2.md` is the implementation source of truth. It supersedes the old Python/Flask PRD and describes a Node.js/TypeScript rewrite. Work in clear vertical slices, keep the repo runnable and tested after each slice, and commit between slices.

Do not turn this into a SaaS dashboard. Keep the app fast, plain, mobile-friendly, deterministic where possible, and explicit when it predicts or classifies anything.

## Current Rewrite Direction

The target stack is:

- Node.js 22.12 or newer and TypeScript.
- React and Tailwind CSS for the client.
- PostgreSQL with explicit SQL through `sql-template-tag`.
- Hand-rolled, up-only SQL migrations.
- `pg-boss` for background jobs.
- Shared Zod schemas for config, API boundaries, job payloads, form payloads, and LLM output.
- `openid-client` for OIDC unless a clearly better mature Node integration is chosen.
- Biome for formatting, linting, and import organization.
- Husky for fast git hooks.
- Vitest for unit and integration tests.
- Playwright for browser E2E tests unless PRD v2 is updated to choose otherwise.

The old Flask, HTMX, Pico CSS, psycopg, pgqueuer, WhiteNoise, uv, ruff, ty, and pytest implementation is prototype reference only. Do not add new Python app code except as a temporary migration aid explicitly called out in `PRD.v2.md`.

## Vertical Slice Workflow

Follow the slices in `PRD.v2.md`.

For every slice:

- Keep files under 500 lines unless there is a strong reason and the file is explicitly easier to maintain that way.
- Prefer small, layered modules over large mixed-concern files.
- Add or update tests with the slice.
- Use Testcontainers-backed Postgres for integration coverage.
- Add Playwright E2E coverage for user-visible flows.
- Run the relevant unit, integration, E2E, and Docker Compose checks before committing.
- Test against real local Docker Compose after each slice.
- Commit with Conventional Commits once the slice is verified.

Slice 0 is documentation and guidance alignment. It must rewrite this file before implementation continues so agents stop following the old stack.

## Architecture Rules

Use a clean layered architecture:

- `src/shared/` for schemas, types, constants, and pure utilities shared by server and client.
- `src/server/` for config, auth, database, migrations, jobs, bank adapters, domain services, and HTTP/API handling.
- `src/client/` for React UI, routing, data-fetching hooks, and browser-only code.
- `src/server/bank/abn/` for the in-repo TypeScript rewrite of the tiny `abna` library.

Keep domain logic out of React components and route handlers. Route handlers should validate input, call services, and return typed output. Services should depend on small database/job/bank interfaces rather than global state.

Do not introduce an ORM for MVP. Do not introduce Prisma, Drizzle, TypeORM, Sequelize, Knex, local password auth, Caddy/basic-auth, multi-user product behavior, or a production deployment architecture.

The packaged artifact remains one 12-factor-style Docker/OCI image published to GHCR. The same image must support `web`, `worker`, `migrate`, and admin commands. Configuration comes from environment variables, secrets must not be baked into the image, logs go to stdout/stderr, and durable data belongs in Postgres.

Generated XLSX files must be stored as Postgres `bytea` blobs and streamed from Postgres on download. Do not rely on durable container filesystem state.

## Product UX Rules

React should improve the UX over the prototype, not recreate HTMX-era page boundaries.

- Dashboard and current-month explanation are one workspace; do not create a separate `/month` page.
- Desktop uses a persistent grouped sidebar.
- Mobile uses bottom navigation for primary workflows.
- Settings must not contain manual current-balance entry; current balance is derived from ABN sync and balance snapshots.
- Dashboard numbers need accessible explanations.
- Review, transaction edits, filtering, and rule previews should preserve context and feel immediate.

## Auth, Security, and Privacy

Use OIDC for normal runtime auth. Protect app and API routes by default; only health checks and static assets should be explicitly public.

Development and tests use:

```text
OIDC_ENABLED=false
OIDC_TESTING_PROFILE_JSON={"sub":"dev-user","nickname":"dev-user","email":"dev-user@example.test","groups":["finance-app"]}
ALLOWED_EMAILS=dev-user@example.test
```

The test profile must still pass the same allowed-email logic as a real OIDC profile.

Do not add local password auth, public registration, Caddy basic auth, or multi-user product behavior. Store secrets in environment variables or mounted secret files. Do not log OIDC tokens, bank credentials, or full raw bank payloads at info level. Use CSRF protection for browser state-changing requests.

Chrome DevTools MCP may be used only with fake/sample data. Never expose real financial data to MCP browser inspection.

## ABN Rewrite

PRD v2 requires a feature-equivalent in-repo TypeScript rewrite of the tiny `abna` library, not a wrapper around Python and not a loose partial adapter.

The ABN client lives under `src/server/bank/abn/`. App sync code should call a bank provider interface; it should not spread ABN protocol details throughout the app.

The rewrite must handle the known `mutationsList` payload shape, including `lastMutationKey`, `clearCacheIndicator`, `descriptionLines`, `sourceInquiryNumber`, `transactionTimestamp`, and `balanceAfterMutation`.

## Testing Requirements

High coverage is non-negotiable.

Required layers:

- Vitest unit tests for pure domain logic.
- Vitest integration tests using Testcontainers Postgres.
- Migration tests from an empty database.
- Job tests for `pg-boss` workflows.
- Classification pipeline tests.
- Forecast calculation tests.
- XLSX export tests.
- API/auth tests.
- Playwright E2E tests for core user-visible flows.
- Docker image command smoke tests.

Use deterministic sample data. Do not use real financial details in tests, screenshots, browser sessions, fixtures, or MCP sessions.

Coverage priorities:

- forecast formula and safe-to-spend math
- classification priority order
- manual overrides and rule backfills
- idempotent imports
- ABN parser/source hash behavior
- balance snapshot derivation
- export blob storage and download
- route auth and allowed-user behavior
- dashboard, review inbox, transactions, rule preview, export, and mobile E2E flows

## Commit Guidelines

Use Conventional Commits:

- `docs: rewrite agent guidance for v2`
- `feat(auth): add oidc test profile flow`
- `test(import): cover idempotent fake provider sync`
- `fix(forecast): use synced balance snapshot`

Pull requests should include a concise description, linked issue or PRD slice, test results, and screenshots or terminal output for user-visible behavior. For UI changes, include evidence from Playwright and browser inspection with sample data.
