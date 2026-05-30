# PRD v2: Personal Finance PWA

Status: Draft v2.0  
Owner: Vadim  
Primary user: one person  
Deployment artifact: Docker/OCI image pushed to GHCR  
Core question: **Am I fine, and what can I still spend this month?**

## 1. Why v2 exists

PRD v1 proved the product shape, but its Python/Flask implementation stack is superseded.

The product direction stays the same: Treasuri is a private personal-finance PWA for one primary user. It should answer the above-the-fold question quickly, stay deterministic where possible, explain predictions and classifications, and avoid becoming a SaaS dashboard.

The architecture changes:

- replace Python/Flask/psycopg/pgqueuer/HTMX/Pico/WhiteNoise with Node.js, TypeScript, React, Tailwind CSS, PostgreSQL, `sql-template-tag`, `pg-boss`, shared Zod schemas, and optionally tRPC
- rewrite the tiny `abna` library exactly as an in-repo TypeScript implementation instead of depending on the Python library
- keep the existing infrastructure boundary: Docker Compose for local dev, Postgres, llama.cpp-compatible local LLM runtime, one GHCR-published app image, no Caddy in dev, no production deployment architecture in this PRD
- keep the same local auth behavior: normal runtime uses OIDC, dev/test use a fake OIDC profile that still passes the allowed-email check

## 1.1 v1 prototype baseline

The v1 prototype is expected to be deleted after v2 settles, so v2 must preserve the useful lessons and behavior that should survive the rewrite.

The current prototype already demonstrates:

```text
Flask app shell with authenticated routes
PostgreSQL schema and hand-rolled SQL migrations
deterministic sample data
fake bank adapter and ABN adapter boundary
idempotent raw transaction import
raw and enriched transaction model
category taxonomy and category routes
normalization helpers
deterministic classification pipeline
local llama-compatible LLM fallback boundary
safe-to-spend forecast calculation
dashboard, review, transactions, categories, rules, recurring, export, settings, and status screens
XLSX generation stored as Postgres bytea
PWA assets and offline fallback
Docker image that can run web, worker, and migrate commands
Docker Compose local stack with app, worker, Postgres, migrations, and llama
Puppeteer E2E harness using sample data
unit, integration, migration, route, job, export, LLM smoke, and Docker image tests
coverage audit notes in docs/coverage-audit.md
```

V2 should reuse product behavior and test intent from the prototype where still correct, but it should not preserve the Python/Flask/HTMX architecture or awkward page boundaries.

Prototype behavior to carry forward:

```text
sample-data-first development
allowed-email auth behavior even in local test-profile mode
explicit SQL migrations
Postgres-backed durable app state
Postgres bytea export storage
deterministic-first classification
LLM failures are non-fatal
manual overrides beat automated classification
idempotent imports
fake provider as default for dev/tests
Chrome DevTools MCP only with sample data
browser E2E acceptance for UI work
small commits between runnable slices
```

Prototype behavior to intentionally change:

```text
replace Python app stack with Node.js and TypeScript
replace server-rendered HTMX/Pico UI with React and Tailwind
replace pgqueuer with pg-boss
replace Python abna dependency with an exact in-repo TypeScript rewrite
combine today/current-month dashboard workflows
remove manual current-balance settings in favor of ABN-derived balance snapshots
use desktop sidebar navigation and mobile bottom navigation
```

## 2. Product philosophy

This is not a bank transaction CRUD app with charts.

The app exists to reduce financial uncertainty by answering a small set of practical questions:

1. How much can I safely spend for the rest of this month?
2. How much can I safely spend per day?
3. Am I ahead or behind my normal spending pace?
4. Which transactions need attention because they affect the forecast?
5. What are my realistic category averages for budgeting?

The ideal daily use case is:

```text
Open app. See whether things are fine. Fix a few transactions if needed. Close app.
```

The app should be fast, plain, mobile-friendly, low-maintenance, deterministic where possible, and explicit when it predicts or classifies anything.

## 3. MVP goals

The MVP should do the following:

1. Import ABN AMRO transactions through an in-repo TypeScript ABN adapter.
2. Store raw imported bank mutations safely and idempotently.
3. Normalize transactions into an internal model.
4. Categorize transactions using a deterministic-first pipeline.
5. Use the local Gemma GGUF model only as a fallback classifier.
6. Show safe-to-spend and safe-per-day for the current month.
7. Predict likely remaining spend for the month.
8. Detect recurring payments and upcoming commitments.
9. Provide a review inbox for uncertain transactions.
10. Let user corrections become future deterministic rules.
11. Export budget averages to XLSX.
12. Store generated XLSX exports as Postgres blobs.
13. Be usable on mobile as a PWA.
14. Use Node.js, TypeScript, React, Tailwind CSS, PostgreSQL, `sql-template-tag`, `pg-boss`, Zod, and Vitest.
15. Use OIDC for authentication in normal runtime.
16. Use OIDC-like test profiles in development and automated tests.
17. Include unit, integration, browser/E2E, migration, job, and container smoke tests from the beginning.
18. Produce a 12-factor-style Docker image pushed to GHCR.

## 4. Non-goals

Do not build these for MVP:

- multi-user product flows
- app-level username/password login
- Caddy basic auth
- bank payments
- account sharing
- receipt scanning
- invoice management
- investment tracking
- double-entry accounting
- public SaaS deployment features
- complex chart dashboards
- generic support for every bank
- YNAB-style envelope budgeting unless added later intentionally
- production deployment architecture
- TLS, ingress, reverse proxy, firewall, backup, or orchestrator setup
- Python app code, Flask, psycopg, pgqueuer, HTMX, Pico CSS, WhiteNoise, uv, ruff, ty, or pytest

## 5. Target stack

```text
Runtime:        Node.js 22.12 or newer
Language:       TypeScript
Server:         Node HTTP app, exact framework still open
Client:         React
CSS:            Tailwind CSS
Client state:   React local state for UI state
Server state:   TanStack Query where it materially reduces fetch/mutation/cache wiring
API typing:     Shared Zod schemas; tRPC if it stays simple
Database:       PostgreSQL
DB driver:      pg
SQL builder:    sql-template-tag
Migrations:     hand-rolled, up-only SQL migration runner
Jobs:           pg-boss
Bank sync:      in-repo TypeScript ABN AMRO adapter
Export:         server-side XLSX generation
Export storage: Postgres bytea blobs
LLM runtime:    llama.cpp-compatible local server
LLM model:      unsloth/gemma-4-E4B-it-GGUF
Auth:           OIDC via openid-client unless a better mature Node OIDC library is chosen
Validation:     Zod
Tooling:        npm or pnpm, Biome, Husky, Vitest, TypeScript
E2E testing:    Playwright or Puppeteer; choose during v2 implementation planning
Local dev:      docker compose
Image registry: GHCR
```

The app should avoid cloud dependencies.

Node 22.12 is the minimum runtime baseline because current `pg-boss` v12 is ESM/TypeScript-first and raised its minimum Node requirement to 22.12.

The same image must support multiple process types:

```text
web
worker
migrate
one-off admin commands
```

Configuration comes from environment variables. Secrets must not be baked into the image. Logs go to stdout/stderr. Durable data belongs in Postgres.

## 6. Architecture rules

### 6.1 Server and client boundary

The frontend is a real React client, but the product should still feel like a utility, not a SPA playground.

Rules:

```text
keep initial routes fast
keep above-the-fold dashboard data easy to load
use TanStack Query for server state, not as a global app-state dumping ground
use React local state for local UI state
use React to make review, drilldown, filtering, and edits feel immediate
prefer in-place panels, drawers, tabs, and progressive disclosure over page-hopping
do not preserve HTMX-era page boundaries when a combined workflow is clearer
avoid unnecessary client-side workflow complexity
avoid chart-heavy dashboards
make all forecast and classification explanations accessible from the UI
```

React should materially improve the workflow:

```text
dashboard numbers can expand into explanations without leaving the page
review actions can update counts, forecast impact, and transaction state immediately
transaction filters should feel instant and preserve context
rule preview should be interactive before historical application
settings changes should show forecast impact where useful
```

Navigation rules:

```text
desktop uses a persistent sidebar with grouped navigation
mobile uses a bottom navigation bar for the primary destinations
secondary tools can live behind a More menu on mobile
navigation should organize workflows, not mirror database tables
```

Suggested desktop sidebar groups:

```text
Overview: Dashboard
Work: Review, Transactions
Planning: Categories, Rules, Recurring
System: Export, Settings, Status
```

The API can be either:

```text
typed HTTP JSON routes validated with Zod
or tRPC routers if the resulting code is simpler and easier to test
```

Decision rule:

```text
Use tRPC only if it reduces duplication without making auth, CSRF, uploads/downloads, or job actions harder to reason about.
```

### 6.2 Shared schemas

Use Zod for shared runtime validation across server and client.

Required schema boundaries:

```text
environment config
OIDC test profile
API requests and responses
transaction edit forms
rule preview and apply requests
settings updates
LLM classifier output
ABN adapter normalized output
export creation requests
```

Rules:

```text
database rows may have dedicated server-only shapes
API output schemas should not leak raw bank payloads
client code must not trust server responses without typed contracts
LLM JSON must be validated strictly before it is stored or shown
```

### 6.3 Database access

Use `pg` plus `sql-template-tag`.

Rules:

```text
write explicit SQL
keep query functions small and named by behavior
use sql-template-tag for parameterized SQL
do not pass user input to raw SQL helpers
do not introduce an ORM
do not introduce Prisma, Drizzle, TypeORM, Sequelize, or Knex for MVP
```

The app should expose small repository-style modules around core tables, but those modules should stay thin. They should not become an invented ORM.

### 6.4 Migrations

Keep v1's hand-rolled migration approach, translated to TypeScript.

Expected command:

```text
npm run migrate
```

or, if pnpm is chosen:

```text
pnpm migrate
```

Migration runner behavior:

```text
create schema_migrations if missing
read migrations/*.sql in filename order
apply each unapplied migration in a transaction where PostgreSQL allows it
record applied version and applied_at
skip already-applied migrations
exit non-zero on migration failure
never auto-rewrite applied migration files
```

Plain SQL files remain the source of truth.

### 6.5 Background jobs

Use `pg-boss` for background jobs.

Required jobs:

```text
sync_abn_transactions
normalize_transactions
classify_transactions
detect_recurring
update_monthly_forecast
generate_xlsx_export
backfill_rule
```

Rules:

```text
jobs must be idempotent where practical
job payloads must be Zod-validated
job names must be stable constants
worker process runs from the same image as web and migrate
job failures are visible in status/admin UI
job code must not require any infrastructure beyond Postgres
```

### 6.6 In-repo TypeScript rewrite of `abna`

The Python `abna` dependency is removed. PRD v2 requires a feature-equivalent TypeScript rewrite of the tiny `abna` library inside this repo, not a loose partial adapter and not a wrapper around Python.

Implement the rewrite inside the repo:

```text
src/server/bank/abn/
```

The rewrite should preserve the library's useful behavior and protocol knowledge:

```text
authentication/session handling needed for read-only mutation sync
request construction for the ABN mutations endpoint
response parsing for mutationsList payloads
pagination or cursor handling through lastMutationKey
clearCacheIndicator handling
typed errors for authentication, transport, and provider payload failures
small public TypeScript API that the app bank provider can call
fixtures copied or recreated from known ABN payload shapes
```

The adapter must expose the same app-level boundary as v1 intended:

```text
list accounts if supported
fetch mutations for configured account and date range
normalize provider fields into app raw transaction input
produce stable provider transaction id or stable source hash inputs
capture balance-after-mutation snapshots
return typed errors that do not leak secrets
```

Rules:

```text
app sync code imports the bank provider interface, not ABN internals
ABN protocol/client code stays in src/server/bank/abn/
fake bank adapter remains the default for dev and tests
ABN credentials come from env vars or mounted secret files
do not log bank credentials
do not log full raw bank payloads at info level
```

The ABN mutations response shape is known and should drive the adapter contract.

Example fields from one mutation:

```text
mutationsList.lastMutationKey
mutationsList.clearCacheIndicator
mutation.mutationCode
mutation.descriptionLines[]
mutation.transactionDate
mutation.valueDate
mutation.bookDate
mutation.balanceAfterMutation
mutation.debitCredit
mutation.counterAccountNumber
mutation.counterAccountType
mutation.counterAccountName
mutation.amount
mutation.currencyIsoCode
mutation.sourceInquiryNumber
mutation.accountNumber
mutation.accountNumberType
mutation.transactionTimestamp
mutation.paymentStatus
mutation.statusTimestamp
```

Mapping rules:

```text
accountNumber maps to account.iban when accountNumberType is IBAN
amount maps directly to signed amount; do not recompute sign from debitCredit unless ABN returns an inconsistent payload
currencyIsoCode maps to currency
bookDate maps to booking date
valueDate maps to value date
transactionDate and transactionTimestamp are retained for identity/debugging
descriptionLines are trimmed, preserved in order, and joined only for normalized display/search fields
counterAccountName maps to counterparty name when present
counterAccountNumber maps to counterparty account when present
balanceAfterMutation creates an account_balance_snapshots row tied to the sync run
mutationsList.lastMutationKey is stored on sync run/provider cursor state for incremental sync
clearCacheIndicator means local provider cursor/cache state must be reset before trusting incremental results
```

Idempotency rules:

```text
primary provider transaction id should use accountNumber + sourceInquiryNumber when sourceInquiryNumber is present
if sourceInquiryNumber is absent, derive a stable source hash from accountNumber, transactionTimestamp, bookDate, amount, currencyIsoCode, counterAccountName, counterAccountNumber, and normalized descriptionLines
store the raw mutation JSON for audit/debugging, but never log it at info level
tests must cover duplicate imports, missing sourceInquiryNumber, blank counterAccountNumber, and balance snapshot creation
```

### 6.7 Auth

Use OIDC in normal runtime. Prefer `openid-client` because it is a mature, framework-neutral OAuth 2 / OpenID Connect client for JavaScript runtimes. This can be revisited if the chosen Node server framework has a clearly better maintained OIDC integration.

Auth requirements:

```text
protect app routes and API routes by default
allow only explicitly public health and static asset routes
support allowed email configuration
deny authenticated users outside the allowlist
store authenticated user identity in server session/request context
provide logout if it is clean with the provider
use secure, HTTPOnly, SameSite cookies in normal runtime
do not add local password auth
do not add public registration
```

Development and tests keep the same useful flow from v1:

```text
OIDC_ENABLED=false
OIDC_TESTING_PROFILE_JSON={"sub":"dev-user","nickname":"dev-user","email":"dev-user@example.test","groups":["finance-app"]}
ALLOWED_EMAILS=dev-user@example.test
```

The test profile must still pass the same allowed-email logic as a real OIDC profile.

### 6.8 CSRF and state changes

State-changing browser requests need CSRF protection.

The final implementation can choose the exact mechanism, but it must cover:

```text
transaction edits
review actions
rule create/edit/disable/apply
settings changes
sync trigger
export generation
logout if applicable
```

## 7. Local development and infra boundary

Infra remains entirely the same in spirit:

```text
docker compose starts app, worker, Postgres, migration/admin support, and llama runtime
no Caddy in local development
app is reachable directly on localhost
Postgres is exposed on a non-default host port, currently 127.0.0.1:15432
inside Compose, services use db:5432
llama uses the same OpenAI-compatible /v1 endpoint contract
the app image is published to GHCR
production TLS, ingress, reverse proxy, orchestration, backups, and firewall are out of scope
```

Required local services:

```text
app
worker
db
llama
```

Required local commands, subject to package manager choice:

```text
npm install
npm run dev
npm run worker
npm run migrate
npm run admin -- seed-categories
npm run admin -- load-sample-data
npm run admin -- sync-now
npm run check
npm run test
npm run test:integration
npm run test:e2e
docker compose up
```

If pnpm is chosen, mirror the same scripts through pnpm.

## 8. Tooling and quality

Use a modern TypeScript tooling stack:

```text
TypeScript for typechecking
Biome for formatting, linting, and import organization
Husky for git hooks
Vitest for unit and integration tests
browser E2E runner to be selected between Playwright and Puppeteer
```

Expected scripts:

```text
typecheck
format
format:check
lint
check
test
test:unit
test:integration
test:e2e
build
dev
worker
migrate
admin
```

`check` should run the non-E2E checks expected before commit:

```text
typecheck
biome check
vitest run
```

Husky should run a fast pre-commit check. It must not make commits painfully slow by running full browser E2E or model smoke tests on every commit.

## 9. Testing strategy

Testing remains a first-class requirement.

Required layers:

```text
unit tests
plain SQL migration tests
Postgres integration tests
job tests with pg-boss
classification pipeline tests
forecast calculation tests
XLSX export tests
API route tests
browser E2E tests
Docker image command smoke tests
```

Use deterministic sample data. Do not use real financial details in tests, screenshots, browser sessions, or fixtures.

Postgres integration tests should use disposable Postgres through the Node Testcontainers library or an equivalent isolated container strategy. Do not require a long-lived local database for the normal test suite.

Coverage priorities:

```text
forecast formula and safe-to-spend math
classification priority order
manual override behavior
idempotent imports
ABN adapter normalization and source hashing
rule preview and backfill
pg-boss job idempotency
export blob storage and download
route auth and allowed-user behavior
dashboard, review inbox, transactions, rule preview, export, and mobile E2E flows
```

## 10. Main user experience

The home screen still answers the main question above the fold.

Example:

```text
May status

Safe to spend:          EUR 558
Safe per day:           EUR 93/day
Projected savings:      EUR 1,087
Target savings:         EUR 1,000
Confidence:             Medium

You are EUR 142 ahead of normal pace.
Eating out is EUR 38 above usual.
Shopping is EUR 120 above usual.
7 transactions need review.
```

The app must never show a magic number without an accessible explanation.

Primary screens:

```text
/                 dashboard and current-month workspace
/transactions     searchable transaction history
/review           transactions needing attention
/categories       category averages and assumptions
/rules            deterministic rule management
/recurring        recurring payments and commitments
/export           XLSX generation and download
/settings         user-controlled assumptions and integrations
/status           app, job, DB, auth, LLM, and export status
```

There should not be separate "today" and "month" pages. The current-day answer and current-month explanation are one workflow:

```text
safe to spend today
safe per day for the rest of the month
current-month pace
projected savings
top category variances
upcoming fixed costs
income status
uncategorized/review impact
```

The dashboard should support drilldown panels for these explanations instead of forcing navigation to a separate month page.

Settings should not ask for values that the app can derive from ABN sync. In particular, current balance is not a manual setting. It should be derived from synced ABN account state and transaction history, then shown with its source and sync timestamp.

Settings should be limited to assumptions and preferences the user actually controls:

```text
target monthly savings
safety buffer
salary day or income expectation rules if needed
baseline window preferences
category taxonomy and inclusion rules
sync lookback and provider configuration
LLM enabled/disabled and confidence threshold
display preferences that do not affect financial truth
```

## 11. Data model

Keep the v1 domain model unless later feedback changes it:

```text
accounts
account_balance_snapshots
raw_transactions
enriched_transactions
categories
merchants
merchant_aliases
categorization_rules
manual_overrides
recurring_series
monthly_forecasts
sync_runs
export_runs
export_files
app_settings
```

Durable application data lives in Postgres.

Generated XLSX files must be stored as normal Postgres `bytea` blobs and streamed from Postgres on download. Do not rely on durable container filesystem state.

`account_balance_snapshots` stores balances reported or derived during ABN sync:

```text
id
account_id
balance
currency
source
as_of
sync_run_id
created_at
```

For ABN, `balanceAfterMutation` is the balance source when present. Current liquid balance should come from the latest trustworthy synced account state, not from manual user input. If the sync source and transaction-derived balance ever disagree, the UI should show the discrepancy as a sync/data-quality issue instead of hiding it behind a setting.

## 12. Classification rules

The deterministic-first classification pipeline stays:

```text
1. Manual overrides
2. High-priority rules
3. Merchant aliases
4. Regex and contains rules
5. Recurring transaction matcher
6. Historical similarity
7. Gemma GGUF LLM fallback
8. Mark as Uncategorized and needs_review
```

The LLM is a fallback classifier, not the primary categorizer.

Rules:

```text
manual overrides always win
rules are priority ordered
rule preview is required before historical application
historical application must not overwrite manual overrides
LLM output must be strict JSON validated by Zod
LLM must not create categories
LLM must not create rules automatically
LLM failures must be non-fatal
classification records store method, confidence, reason, model ref, and prompt version where applicable
```

## 13. Forecasting

The main formula stays:

```text
safe_to_spend =
  synced_current_liquid_balance
  + expected_income_remaining
  - fixed_costs_upcoming
  - predicted_variable_remaining
  - target_savings_remaining
  - safety_buffer
```

Then:

```text
safe_per_day = safe_to_spend / days_left_in_month
```

Rules:

```text
safe_to_spend may be negative
safe_per_day includes today
negative values should be shown clearly
dashboard must explain the calculation
current balance is derived from ABN sync and must show source/as-of metadata
confidence drops when sync is stale, review burden is high, salary is missing, or recurring detection is uncertain
```

## 14. Runtime image contract

The project produces one OCI/Docker image.

Expected image name:

```text
ghcr.io/<owner>/<repo>:<tag>
```

Supported process types:

```text
web
worker
migrate
admin
```

The image should:

```text
run as non-root
fail fast on invalid required config
write logs to stdout/stderr
not rely on local persistent filesystem state
serve built React/static assets from inside the image
support Postgres-only durable state
```

Required environment variables will be finalized during implementation planning, but must include:

```text
DATABASE_URL
SECRET_KEY
OIDC_ENABLED
OIDC_ISSUER_URL
OIDC_CLIENT_ID
OIDC_CLIENT_SECRET
OIDC_REDIRECT_URI
ALLOWED_EMAILS
LLM_ENABLED
LLM_BASE_URL
LLM_MODEL
LLM_TIMEOUT_SECONDS
LLM_CLASSIFICATION_TEMPERATURE
BANK_PROVIDER
ABN_ACCOUNT_IBAN
```

Dev/test-only:

```text
OIDC_TESTING_PROFILE_JSON
```

## 15. Vertical implementation slices

The v2 implementation is a rewrite, not a line-by-line port. Work in vertical slices like v1: each slice should leave the repo runnable, tested, and easier to continue from. Commit between slices.

### Slice 0: Rewrite repo guidance first

Purpose: make agents stop following the old Python/Flask instructions before implementation starts.

Deliverables:

```text
AGENTS.md rewritten for PRD v2
README warning that v2 rewrite is in progress
PRD.v2.md referenced as the current source of truth
old Flask/uv/pytest/HTMX/Pico/WhiteNoise guidance removed from AGENTS.md
new Node/TypeScript/React/Tailwind/Biome/Husky/Vitest/pg-boss/sql-template-tag guidance added
Chrome DevTools MCP sample-data-only rule preserved
small-slice commit guidance preserved
```

Acceptance criteria:

```text
AGENTS.md no longer instructs agents to build Flask, HTMX, or Python app code
AGENTS.md explicitly says v2 is a Node/TypeScript rewrite
AGENTS.md says PRD.v2.md supersedes PRD.md for implementation
AGENTS.md keeps the no-real-financial-data-in-MCP rule
AGENTS.md requires vertical slices that stay runnable and tested
```

### Slice 1: TypeScript workspace and quality gate

Purpose: establish the new toolchain without product behavior yet.

Deliverables:

```text
package.json
package lockfile
tsconfig.json
biome.json
husky hooks
src/server, src/client, src/shared layout
Vitest setup
minimal TypeScript smoke test
basic CI update for typecheck, Biome, and Vitest
```

Acceptance criteria:

```text
install command works
typecheck passes
Biome check passes
Vitest passes
Husky fast pre-commit hook exists
old Python tests may still exist temporarily but are not the v2 quality gate
```

### Slice 2: Node server, React shell, and navigation

Purpose: prove the new runtime and UI shape before porting finance behavior.

Deliverables:

```text
Node server entrypoint
React app shell
Tailwind setup
desktop sidebar navigation
mobile bottom navigation
health route
static asset serving from the Node server
browser smoke test
```

Acceptance criteria:

```text
local app starts through npm script
desktop viewport shows grouped sidebar navigation
mobile viewport shows bottom navigation
health route is public
React shell renders without real financial data
browser smoke test passes
```

### Slice 3: Config, auth test profile, and route protection

Purpose: preserve v1's useful local auth behavior in the new stack.

Deliverables:

```text
Zod environment config
openid-client runtime auth skeleton
OIDC_ENABLED=false test-profile path
OIDC_TESTING_PROFILE_JSON parsing
allowed-email enforcement
session cookie setup
protected app/API route helpers
auth route tests
```

Acceptance criteria:

```text
app and API routes are protected by default
health and static assets remain public
test profile works without a live OIDC provider
test profile still passes the same allowed-email logic
users outside ALLOWED_EMAILS are denied
no local password auth exists
```

### Slice 4: Postgres, migrations, and Docker Compose

Purpose: recreate the v1 runtime foundation on Node.

Deliverables:

```text
pg connection helper
sql-template-tag query helper conventions
hand-rolled SQL migration runner
schema_migrations table
initial SQL migrations
Dockerfile
docker compose update for app, worker, db, migrate, and llama
container command smoke tests
```

Acceptance criteria:

```text
migrations apply from a clean database
already-applied migrations are skipped
docker compose starts app, worker, Postgres, migrations, and llama
Postgres remains exposed on non-default host port 127.0.0.1:15432
no Caddy service exists
same image can run web, worker, and migrate commands
```

### Slice 5: Core schema and sample data

Purpose: port the prototype's deterministic data baseline.

Deliverables:

```text
accounts
account_balance_snapshots
raw_transactions
enriched_transactions
categories
merchants
merchant_aliases
categorization_rules
manual_overrides
recurring_series
monthly_forecasts
sync_runs
export_runs
export_files
app_settings
category seed data
sample data loader
fake bank provider
Postgres integration tests
```

Acceptance criteria:

```text
clean database can be migrated and seeded
sample data loads idempotently
fake provider is default for dev/tests
sample data contains review-worthy and forecast-relevant transactions
integration tests use disposable Postgres
```

### Slice 6: Import, normalization, and synced balance

Purpose: restore the transaction ingestion path and remove manual balance assumptions.

Deliverables:

```text
bank provider interface
raw transaction insert with idempotency
normalization service
source hash helper
balance snapshot writer
sync run recording
foreground sync-now admin command
tests for duplicate imports and balance snapshots
```

Acceptance criteria:

```text
same fake fixture imported twice creates no duplicates
each raw transaction gets one enriched transaction
current liquid balance is derived from latest balance snapshot
settings do not include manual current-balance entry
sync errors are recorded safely
```

### Slice 7: In-repo TypeScript `abna` rewrite

Purpose: replace the Python `abna` dependency with an exact in-repo TypeScript implementation.

Deliverables:

```text
feature-equivalent in-repo TypeScript rewrite of the tiny abna library
small public ABN client API
ABN protocol/client code under src/server/bank/abn/
mutationsList parser
lastMutationKey cursor handling
clearCacheIndicator reset handling
balanceAfterMutation mapping
fixture-based parser tests
auth/session failure tests where fixtures or mocks allow
safe typed errors
integration with the bank provider interface
```

Acceptance criteria:

```text
app no longer depends on Python abna
the app provider layer calls the in-repo ABN client instead of reimplementing protocol details
sourceInquiryNumber and fallback source-hash idempotency are tested
blank counterAccountNumber is handled
balanceAfterMutation creates account balance snapshots
sync errors do not leak credentials or full raw payloads at info level
```

### Slice 8: Classification and review workflow

Purpose: port the deterministic-first categorization behavior with a better React review UX.

Deliverables:

```text
manual override service
rules engine
merchant aliases
historical similarity
LLM classifier boundary and strict Zod output validation
review inbox API
review inbox React UI
in-place accept/change/exclude actions
classification tests
review route/API tests
browser review flow test
```

Acceptance criteria:

```text
manual overrides always win
classification priority order is covered by tests
invalid LLM JSON and invented categories fail safely
review actions update transaction state without losing page context
review count updates after actions
```

### Slice 9: Forecast dashboard and current-month workspace

Purpose: answer the product's main question in the new consolidated React UI.

Deliverables:

```text
forecast calculation service
category averages
safe-to-spend API
dashboard and current-month workspace
drilldown panels for explanations
top variances
upcoming fixed costs
income status
uncategorized/review impact
forecast tests
desktop and mobile browser tests
```

Acceptance criteria:

```text
dashboard answers safe-to-spend above the fold on mobile
today and month are not separate pages
safe-to-spend uses synced_current_liquid_balance
current balance shows source/as-of metadata
negative safe-to-spend is clear
forecast explanation is accessible from the dashboard
```

### Slice 10: Transactions, rules, categories, and recurring

Purpose: port the main management workflows with React interactions.

Deliverables:

```text
transactions screen with fast filters
transaction edit flows
rule create/edit/disable UI
rule preview and apply job
categories screen
recurring screen
route/API tests
browser workflow tests
```

Acceptance criteria:

```text
transaction filters preserve context and feel instant
manual edits persist
rule preview happens before historical changes
rule application does not overwrite manual overrides
recurring commitments can affect the forecast
```

### Slice 11: Jobs, exports, settings, and status

Purpose: complete operational workflows from the prototype.

Deliverables:

```text
pg-boss worker wiring
sync_abn_transactions job
normalize_transactions job
classify_transactions job
detect_recurring job
update_monthly_forecast job
generate_xlsx_export job
backfill_rule job
XLSX generation and Postgres bytea storage
export UI
settings UI for user-controlled assumptions only
status UI
job/export/settings/status tests
```

Acceptance criteria:

```text
worker runs from the same image as the web process
job payloads are Zod-validated
job failures are visible in status
export files are stored in Postgres bytea
downloads stream from Postgres
settings do not contain derived financial truth like current balance
status page redacts secrets
```

### Slice 12: PWA, CI, GHCR, and hardening

Purpose: finish the artifact and quality bar.

Deliverables:

```text
PWA manifest and service worker
safe offline fallback
E2E reliability pass
coverage audit refresh
Docker image command smoke tests
GHCR publishing workflow
README rewritten for v2
old PRD deletion or archival after v2 approval
```

Acceptance criteria:

```text
CI runs typecheck, Biome, Vitest, integration tests, browser E2E, and image build
image is published to GHCR only after checks pass
web image serves built React assets
offline mode does not expose full transaction history before auth
README no longer documents Python commands
PRD.v2.md stands alone without needing PRD.md
```

## 16. Open decisions

These are intentionally still open:

```text
Node package manager: npm or pnpm
Node server framework: bare Node HTTP, Express, Fastify, Hono, or another small server
API style: Zod-validated HTTP routes or tRPC
browser E2E runner: Playwright or Puppeteer
exact session storage mechanism
exact CSRF mechanism
exact OIDC session/callback implementation around openid-client
whether to keep pg-boss in its default schema or an app-owned schema
whether to use Vite directly for the React build
exact XLSX library
exact ABN credential handling
whether CI should ever run an optional real-llama smoke test
```

No longer open:

```text
runtime language: TypeScript
server runtime: Node.js
client: React
styling: Tailwind CSS
database: PostgreSQL
SQL style: explicit SQL through sql-template-tag
job queue: pg-boss
schema validation: Zod
linter/formatter/import organization: Biome
git hooks: Husky
unit/integration test runner: Vitest
Python app stack: removed
Flask/psycopg/pgqueuer/HTMX/Pico/WhiteNoise/uv/ruff/ty/pytest: removed
local dev orchestration: docker compose
local dev reverse proxy: none
runtime artifact: Docker/OCI image
image registry: GHCR
LLM model repo: unsloth/gemma-4-E4B-it-GGUF
XLSX export storage: Postgres bytea blobs
current balance source: derived from ABN sync, not manual settings
```

## 17. Reference links for stack choices

- Node OIDC candidate: https://github.com/panva/openid-client
- SQL template tag: https://github.com/blakeembrey/sql-template-tag
- pg-boss: https://github.com/timgit/pg-boss
- TanStack Query React docs: https://tanstack.com/query/latest/docs/framework/react/
- tRPC TanStack Query integration: https://trpc.io/docs/client/tanstack-react-query/setup
- Zod: https://zod.dev/
- Tailwind CSS with Vite: https://tailwindcss.com/docs/installation/using-vite
- Biome linter: https://biomejs.dev/linter/
- Husky: https://typicode.github.io/husky/
- Vitest test file conventions: https://main.vitest.dev/guide/learn/writing-tests
