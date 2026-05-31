# Treasuri

Treasuri is a private personal-finance PWA for one primary user. The product question is: am I fine, and what can I still spend this month?

`PRD.v2.md` is the implementation source of truth. It replaces the deleted v1 PRD and is written to stand on its own.

## Stack

- Node.js 22.12 or newer with TypeScript.
- Express for the server runtime.
- React, Tailwind CSS, and TanStack Query on the client.
- PostgreSQL, explicit SQL, and hand-rolled up-only migrations.
- `pg-boss` for background jobs.
- Shared Zod schemas across API, forms, config, and job payloads.
- In-repo TypeScript ABN AMRO client under `src/server/bank/abn/`.
- Biome, Husky, Vitest, Playwright, and Testcontainers.
- One Docker/OCI image published to GHCR for web, worker, migration, and admin commands.

## Local Development

Install dependencies:

```sh
npm ci
```

Run the app locally without Compose:

```sh
npm run dev
```

Run the full local stack:

```sh
docker compose up -d --build
docker compose run --rm app npm run admin -- load-sample-data
```

The app listens on `http://127.0.0.1:5000` in Compose. Postgres is exposed on `127.0.0.1:15432`.

## Commands

```sh
npm run check
npm run build
npm run test:e2e
npm run migrate
npm run worker
npm run admin -- load-sample-data
```

## Configuration

Local development uses deterministic sample data and test-profile auth:

```text
OIDC_ENABLED=false
OIDC_TESTING_PROFILE_JSON={"sub":"dev-user","nickname":"dev-user","email":"dev-user@example.test","groups":["finance-app"]}
ALLOWED_EMAILS=dev-user@example.test
BANK_PROVIDER=fake
```

Use `BANK_PROVIDER=abn` or `BANK_PROVIDER=abn_amro` only with mounted secrets or environment values for the ABN credentials. Do not put real financial data in fixtures, screenshots, logs, or browser automation sessions.

## Verification Bar

Every vertical slice should leave the repo runnable and tested:

- Vitest unit and integration coverage.
- Testcontainers-backed Postgres coverage.
- Playwright E2E coverage for user-visible workflows.
- Real local Docker Compose verification.
- Docker image command smoke coverage in CI before GHCR publish on `v*` tags.

Generated XLSX exports are stored in Postgres `bytea` and streamed from Postgres on download. Durable container filesystem state is not part of the product contract.
