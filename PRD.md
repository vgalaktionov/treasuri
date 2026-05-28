# PRD: Personal Finance PWA

Status: Draft v1.0  
Owner: Vadim  
Primary user: one person  
Deployment artifact: Docker/OCI image pushed to GHCR  
Core question: **Am I fine, and what can I still spend this month?**

## 1. Product philosophy

This is not a bank transaction CRUD app with charts.

The app exists to reduce financial uncertainty by answering a small set of practical questions:

1. How much can I safely spend for the rest of this month?
2. How much can I safely spend per day?
3. Am I ahead or behind my normal spending pace?
4. Which transactions need attention because they affect the forecast?
5. What are my realistic category averages for budgeting?

The app should feel like a private utility, not a SaaS product.

It should be:

- fast
- plain
- mobile-friendly
- low-maintenance
- deterministic where possible
- explainable when it makes a prediction
- heavily tested from the beginning

The ideal daily use case is:

> Open app. See whether things are fine. Fix a few transactions if needed. Close app.

The app should reduce anxiety, not create a second banking dashboard to obsess over.

## 2. MVP goals

The MVP should do the following:

1. Import ABN AMRO transactions through an adapter around the `abna` library.
2. Store raw imported bank mutations safely and idempotently.
3. Normalize transactions into an internal model.
4. Categorize transactions using a deterministic-first pipeline.
5. Use the local Gemma GGUF model only as a fallback classifier.
6. Show safe-to-spend and safe-per-day for the current month.
7. Predict likely remaining spend for the month.
8. Detect recurring payments and upcoming commitments.
9. Provide a review inbox for uncertain transactions.
10. Let user corrections become future rules.
11. Export budget averages to XLSX.
12. Store generated XLSX exports as Postgres blobs.
13. Be usable on mobile as a PWA.
14. Use Flask, Postgres, psycopg, plain SQL migrations, pgqueuer, HTMX, and Pico CSS.
15. Use Flask-OIDC for authentication.
16. Use OIDC test profiles in development and automated tests.
17. Include unit, integration, and Puppeteer E2E tests from the beginning.
18. Produce a 12-factor-style Docker image pushed to GHCR.

## 3. Non-goals

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
- React, Vue, Svelte, or frontend build tooling
- generic support for every bank
- YNAB-style envelope budgeting unless added later intentionally
- production deployment architecture
- TLS, ingress, reverse proxy, firewall, backup, or orchestrator setup

## 4. Target stack

Initial stack:

```text
Backend:        Flask
Auth:           Flask-OIDC
Database:       PostgreSQL
DB access:      plain psycopg
Migrations:     hand-rolled plain SQL migration system
Jobs:           pgqueuer
Frontend:       server-rendered HTML
Interactivity:  HTMX
CSS:            Pico CSS
Static files:   Flask static in dev, WhiteNoise in packaged web image
Bank sync:      ABN adapter wrapping abna
Export:         server-side XLSX generation
Export storage: Postgres bytea blobs
LLM runtime:    llama.cpp-compatible local server
LLM model:      unsloth/gemma-4-E4B-it-GGUF
Tooling:        uv, ruff, ty, pytest
E2E testing:    Puppeteer
Local dev:      docker compose
Image registry: GHCR
```

No Caddy in local development.

No production deployment architecture is specified in this PRD.

The app deliverable is a dockerized 12-factor-style application image pushed to GHCR. Actual hosting, reverse proxy, TLS, service orchestration, secrets management, backups, and runtime networking are out of scope for this app.

The image must be configurable entirely through environment variables.

The same image should support multiple process types:

```text
web
worker
migrate
one-off admin commands
```

The app should avoid cloud dependencies.

Local development should be production-like where it matters:

```text
same database engine
same migration path
same worker process
same llama runtime path
same model repository
same model quantization/config where practical
same application auth behavior through OIDC_TESTING_PROFILE
```

The app should have clear adapter boundaries for:

```text
bank providers
classification providers
export generation
forecast calculation
background jobs
authentication/user context
LLM runtime client
```

## 4.1 Python tooling

Use modern Python project tooling.

Required tools:

```text
uv
ruff
ty
pytest
```

Required project files:

```text
pyproject.toml
uv.lock
README.md
```

Expected commands:

```text
uv sync
uv run python -m app.web
uv run python -m app.worker
uv run python -m app.migrate
uv run python -m app.admin seed-categories
uv run python -m app.admin sync-now
uv run pytest
uv run ruff check .
uv run ruff format --check .
uv run ty check
```

Do not introduce:

```text
pip-tools
poetry
black
isort as separate tool
mypy
tox
nox
```

Ruff owns linting and formatting.

ty owns type checking.

pytest owns Python tests.

## 4.2 JavaScript tooling for E2E only

JavaScript exists only for Puppeteer E2E tests and Codex UI tooling.

It must not become a frontend build pipeline.

Expected layout:

```text
e2e/
  package.json
  package-lock.json
  tests/
```

Expected commands:

```text
npm ci --prefix e2e
npm test --prefix e2e
```

Rules:

```text
no frontend bundler
no client-side app framework
no TypeScript build step unless Puppeteer tests truly need it
no generated JS assets for the Flask app
HTMX and Pico CSS are vendored or served as static assets
```

## 4.3 LLM runtime and model

Both local development and runtime environments use the same model repository:

```text
unsloth/gemma-4-E4B-it-GGUF
```

Default model ref:

```text
unsloth/gemma-4-E4B-it-GGUF:UD-Q4_K_XL
```

The classifier should talk to a local OpenAI-compatible llama server.

Default local endpoint:

```text
http://llama:8080/v1/chat/completions
```

Default app config:

```text
LLM_ENABLED=true
LLM_BASE_URL=http://llama:8080/v1
LLM_MODEL=unsloth/gemma-4-E4B-it-GGUF:UD-Q4_K_XL
LLM_TIMEOUT_SECONDS=10
LLM_CLASSIFICATION_TEMPERATURE=0
```

Rules:

```text
dev and runtime must use the same model repo
dev and runtime should use the same quantization unless hardware constraints force otherwise
the exact model ref must be visible in the UI/admin status
classification records must store model ref and prompt version
LLM failures must not break sync
LLM output must be validated as strict JSON
the model may suggest categories, but must not create categories
the model may suggest merchants, but must not create rules automatically
```

Prefer one OpenAI-compatible llama endpoint so the Flask code does not care how the model is hosted.

## 4.4 Local development

Local development is docker compose.

No Caddy in dev.

Required services:

```text
app
worker
db
llama
```

Optional services:

```text
adminer or pgweb, if useful
```

The local compose file exists only for development.

It is not a production deployment template.

The app service should be exposed directly on localhost.

Required local commands:

```text
docker compose up
docker compose exec app uv run python -m app.migrate
docker compose exec app uv run pytest
docker compose exec app uv run ruff check .
docker compose exec app uv run ty check
npm ci --prefix e2e
npm test --prefix e2e
```

The app contract with the llama service should be stable:

```text
OpenAI-compatible /v1 endpoint
same model ref in dev and runtime environments
temperature 0 for classification
JSON-only response expected
```

Local development uses OIDC test mode:

```text
OIDC_ENABLED=false
OIDC_TESTING_PROFILE_JSON={"sub":"dev-user","nickname":"dev-user","email":"dev-user@example.test","groups":["finance-app"]}
ALLOWED_EMAILS=dev-user@example.test
```

The app should parse `OIDC_TESTING_PROFILE_JSON` into the Flask config value `OIDC_TESTING_PROFILE`.

## 4.5 Runtime image contract

The project should produce one OCI/Docker image.

Expected image name:

```text
ghcr.io/<owner>/<repo>:<tag>
```

Recommended tags:

```text
ghcr.io/<owner>/<repo>:<git-sha>
ghcr.io/<owner>/<repo>:latest
```

The image must not contain secrets.

Configuration must come from environment variables.

Required environment variables:

```text
DATABASE_URL
SECRET_KEY
OIDC_CLIENT_SECRETS
OIDC_ID_TOKEN_COOKIE_SECURE
OIDC_OPENID_REALM
OIDC_SCOPES
ALLOWED_EMAILS
LLM_ENABLED
LLM_BASE_URL
LLM_MODEL
LLM_TIMEOUT_SECONDS
LLM_CLASSIFICATION_TEMPERATURE
BANK_PROVIDER
ABN_ACCOUNT_IBAN
```

Optional environment variables:

```text
APP_ENV
LOG_LEVEL
HTTP_HOST
HTTP_PORT
WORKER_CONCURRENCY
SYNC_LOOKBACK_DAYS
EXPORT_RETENTION_DAYS
OIDC_ENABLED
OIDC_TESTING_PROFILE_JSON
```

Supported commands:

```text
uv run python -m app.web
uv run python -m app.worker
uv run python -m app.migrate
uv run python -m app.admin seed-categories
uv run python -m app.admin sync-now
```

The image should:

```text
run as non-root
fail fast on invalid required config
write logs to stdout/stderr
not rely on local persistent filesystem state
serve static files from inside the image using WhiteNoise
```

Durable application data lives in Postgres.

This includes:

```text
bank transactions
classification metadata
rules
settings
forecast snapshots
export history
generated XLSX blobs
```

Generated XLSX files must not be stored permanently on the container filesystem.

Generated XLSX files should be stored in Postgres and streamed from Postgres when downloaded.

## 4.6 Codex and UI development workflow

Codex should use Chrome DevTools MCP to aid UI development.

The repo should include an `AGENTS.md` or equivalent agent instruction file that says:

```text
Use ChromeDevTools/chrome-devtools-mcp for UI work.
For UI tasks, inspect the running app in Chrome.
Use screenshots, console logs, network inspection, and DOM inspection before marking UI work complete.
Use sample data only when Chrome DevTools MCP is connected.
Do not open real financial data in browser sessions exposed to MCP tooling.
Do not rely only on static template inspection for UI tasks.
Puppeteer E2E tests remain the automated acceptance layer.
Chrome DevTools MCP is an implementation aid, not a replacement for tests.
```

Suggested Codex MCP setup note for repo docs:

```text
codex mcp add chrome-devtools -- npx chrome-devtools-mcp@latest
```

## 5. Main user experience

The home screen should answer the main question above the fold.

Example:

```text
May status

Safe to spend:          €558
Safe per day:           €93/day
Projected savings:      €1,087
Target savings:         €1,000
Confidence:             Medium

You are €142 ahead of normal pace.
Eating out is €38 above usual.
Shopping is €120 above usual.
7 transactions need review.
```

Supporting details should be available, but secondary.

Example breakdown:

```text
Income received:        €5,258
Expected income left:   €0
Fixed costs paid:       €2,140
Fixed costs upcoming:   €620
Variable spent:         €1,180
Predicted variable:     €760
Safety buffer:          €1,000
```

The app should never show a magic number without being able to explain it.

## 6. Core data model

### 6.1 Account

Represents a bank account or logical financial account.

Fields:

```text
id
provider
iban
name
currency
is_active
created_at
updated_at
```

### 6.2 Raw transaction

Imported bank mutation as close to the source as practical.

Fields:

```text
id
account_id
provider
provider_transaction_id
source_hash
booking_date
value_date
amount
currency
counterparty_name
counterparty_iban
description
raw_payload_json
first_seen_at
last_seen_at
```

`source_hash` must be stable and idempotent.

Use provider transaction ID if available. Otherwise derive from stable source fields:

```text
account_id
booking_date
amount
counterparty
description
bank-specific stable metadata
```

### 6.3 Enriched transaction

The app’s interpretation of a raw transaction.

Fields:

```text
id
raw_transaction_id
merchant_id
category_id
subcategory
is_income
is_transfer
is_savings
is_fixed_cost
is_variable_cost
is_recurring
is_one_off
is_excluded_from_budget
needs_review
classification_method
classification_confidence
classification_reason
classification_model
classification_prompt_version
rule_id
recurring_series_id
notes
created_at
updated_at
```

### 6.4 Merchant

Canonical merchant grouping.

Fields:

```text
id
name
normalized_name
default_category_id
created_at
updated_at
```

Examples:

```text
Albert Heijn
Amazon
NS
Spotify
IKEA
```

### 6.5 Merchant alias

Maps noisy bank text to canonical merchants.

Fields:

```text
id
merchant_id
match_text
match_type: contains | exact | regex
priority
is_active
created_at
updated_at
```

Examples:

```text
"AH TO GO AMSTERDAM" -> Albert Heijn
"ALBERT HEIJN 1297" -> Albert Heijn
"AMZNMktplace" -> Amazon
```

### 6.6 Category

Initial taxonomy:

```text
Income
Transfers
Savings
Rent / Mortgage
Utilities
Insurance
Groceries
Eating out
Transport
Car
Dog
Health
Subscriptions
Shopping
Household
Entertainment
Travel
Gifts
Taxes
Fees
One-off / Large purchase
Unknown
```

Important: categories should not carry all meaning.

Use flags for cross-cutting concepts:

```text
is_income
is_transfer
is_savings
is_fixed_cost
is_recurring
is_one_off
is_excluded_from_budget
```

Example:

```text
Category: Shopping
Flags: one_off, excluded_from_budget
```

### 6.7 Categorization rule

Human-owned deterministic rule.

Fields:

```text
id
name
priority
is_active
field
operator
pattern
category_id
merchant_id
set_is_income
set_is_transfer
set_is_savings
set_is_fixed_cost
set_is_excluded_from_budget
created_from_transaction_id
created_at
updated_at
```

Supported fields:

```text
description
counterparty_name
counterparty_iban
amount
account_id
merchant
```

Supported operators:

```text
contains
exact
regex
starts_with
ends_with
amount_between
```

Rules must support preview before historical application.

### 6.8 Manual override

A user correction that always wins.

Fields:

```text
id
enriched_transaction_id
category_id
merchant_id
flags_json
notes
created_at
updated_at
```

Manual overrides are the highest-priority classification source.

### 6.9 Recurring series

Represents detected or confirmed recurring payments.

Fields:

```text
id
merchant_id
category_id
name
cadence
amount_mode
expected_amount
amount_tolerance
expected_day_of_month
next_expected_date
confidence
is_confirmed
is_active
created_at
updated_at
```

Cadence values:

```text
weekly
monthly
quarterly
yearly
irregular
```

Amount mode:

```text
fixed
variable
```

### 6.10 Monthly forecast

Stored forecast snapshot.

Fields:

```text
id
year_month
income_received
expected_income_remaining
fixed_costs_paid
fixed_costs_upcoming
variable_spent
predicted_variable_remaining
target_savings
safety_buffer
safe_to_spend
safe_per_day
projected_savings
confidence
explanation_json
created_at
updated_at
```

### 6.11 Export run

Represents an attempt to generate a budget export.

Fields:

```text
id
export_type
period_start
period_end
status
started_at
finished_at
error_message
created_by
metadata_json
```

Status values:

```text
pending
running
completed
failed
```

### 6.12 Export file

Stores the generated XLSX as a Postgres blob.

Use normal `bytea`, not the Postgres large object API, unless file sizes somehow become unreasonable later.

Fields:

```text
id
export_run_id
filename
content_type
content
size_bytes
sha256
created_at
```

Expected content type:

```text
application/vnd.openxmlformats-officedocument.spreadsheetml.sheet
```

Rules:

```text
export files are durable application data
export files are stored in Postgres
export files are downloaded only by an authenticated allowed user
export files are not written permanently to container disk
temporary files may be used during generation if needed, but must be deleted
```

### 6.13 App setting

Stores user-configurable app assumptions.

Fields:

```text
key
value_json
updated_at
```

Initial settings:

```text
target_monthly_savings
safety_buffer
salary_day
baseline_months
llm_enabled
llm_confidence_threshold
sync_lookback_days
```

### 6.14 Job run and sync run

Track background work for visibility.

Fields for sync runs:

```text
id
provider
started_at
finished_at
status
new_transaction_count
updated_transaction_count
error_message
metadata_json
```

Fields for job visibility can be either pgqueuer-native or app-owned depending on what pgqueuer exposes cleanly.

## 7. Categorization pipeline

Classification order:

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

The LLM is not the boss. It is the intern.

Every classification must store:

```text
classification_method
classification_confidence
classification_reason
rule_id, if applicable
model_name, if applicable
prompt_version, if applicable
```

### 7.1 Manual overrides

Manual overrides always win.

Re-running the classifier must not undo manual corrections.

### 7.2 Rules

Rules are deterministic and priority ordered.

A rule can set:

```text
merchant
category
flags
review status
```

Rules need preview support before applying them to historical transactions.

Preview should show:

```text
Matches: 42 transactions
Would change Uncategorized -> Groceries: 6
Would change Shopping -> Groceries: 2
Already correct: 34
Manual overrides skipped: 3
```

### 7.3 Merchant aliases

Merchant aliases clean up noisy transaction descriptions.

If a merchant has a default category, the alias can classify the transaction.

Example:

```text
description contains "ALBERT HEIJN"
merchant = Albert Heijn
category = Groceries
```

### 7.4 Historical similarity

Use previous manual corrections as high-quality examples.

Simple MVP approach:

```text
normalize description
normalize counterparty
compare common tokens
compare merchant if known
compare amount band
prefer manually corrected examples
```

No vector search needed for MVP.

### 7.5 Gemma GGUF LLM fallback

The LLM classifier receives a closed vocabulary and returns structured JSON only.

Input:

```text
date
amount
counterparty
description
allowed categories
known merchant aliases
examples, optional
```

Expected output:

```json
{
  "merchant": "Albert Heijn",
  "category": "Groceries",
  "subcategory": "Supermarket",
  "confidence": 0.86,
  "needs_review": false,
  "reason": "Counterparty and description look like a supermarket purchase."
}
```

Rules:

```text
Do not allow invented categories.
Do not allow model-created rules.
Reject invalid JSON.
Reject categories not in taxonomy.
Low confidence results go to review.
Store model name and prompt version.
Do not send unnecessary transaction history.
Keep prompts small.
Keep examples limited and curated.
```

## 8. Forecasting

### 8.1 Main formula

```text
safe_to_spend =
  current_liquid_balance
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
the dashboard must explain the calculation
```

### 8.2 Fixed costs

Fixed costs come from:

```text
recurring series
transactions flagged fixed
confirmed subscriptions
known monthly commitments
```

Examples:

```text
rent or mortgage
insurance
utilities
phone
subscriptions
loan payments
recurring dog costs
```

The app should show upcoming fixed costs for the rest of the month.

### 8.3 Variable spend prediction

For each variable category:

```text
baseline_3m = average of last 3 complete months
baseline_6m = average of last 6 complete months
baseline_12m = average of last 12 complete months
current_spend = current month spend so far
pace_projection = current_spend / elapsed_days * days_in_month
```

MVP prediction:

```text
predicted_month_end = max(baseline_3m, baseline_6m, pace_projection)
predicted_remaining = max(0, predicted_month_end - current_spend)
```

This is intentionally conservative.

Exclude from baselines:

```text
income
transfers
savings
excluded transactions
confirmed one-off large purchases
```

### 8.4 Forecast confidence

Values:

```text
high
medium
low
```

Reduce confidence when:

```text
latest sync is stale
many current-month transactions are uncategorized
salary is expected but not seen
large transaction needs review
recurring detection is uncertain
current month has too little history
LLM produced low-confidence classifications
```

## 9. Key screens

### 9.1 Dashboard: `/`

Purpose: answer the main question.

Must show:

```text
safe to spend
safe per day
projected savings
target savings
forecast confidence
last sync status
review count
top variances
upcoming fixed costs
```

The safe-to-spend number must be the visual priority.

### 9.2 Transactions: `/transactions`

Purpose: searchable transaction history.

Filters:

```text
uncategorized
needs review
this month
category
merchant
amount range
excluded
income
transfers
recurring
```

Each transaction should show:

```text
date
amount
merchant or counterparty
description
category
flags
classification method
review status
```

Actions:

```text
edit category
edit merchant
mark transfer
mark savings
mark one-off
exclude from budget
create rule
view raw data
```

Mobile layout should use cards.

Desktop can use a table.

### 9.3 Review inbox: `/review`

Purpose: fix only what needs attention.

Show transactions where:

```text
no category
low confidence classification
invalid LLM output
important unknown transaction
explicitly marked for review
```

Actions:

```text
accept suggestion
change category
change merchant
mark transfer
mark savings
mark one-off
exclude from budget
create rule from transaction
apply same decision to similar transactions
```

Core UX:

```text
You changed this to Dog.
Apply to 8 similar transactions?
```

### 9.4 Month view: `/month`

Purpose: understand the current month.

Show:

```text
safe to spend
safe per day
projected savings
category pace
fixed costs paid
fixed costs upcoming
income status
uncategorized impact
```

Example:

```text
Groceries       €412 / €520 expected     on track
Eating out      €218 / €180 expected     +€38
Dog             €146 / €90 expected      +€56
Subscriptions   €78 / €78 expected       done
Shopping        €340 / €220 expected     +€120
```

### 9.5 Categories: `/categories`

Purpose: budgeting assumptions and averages.

Show per category:

```text
current month
3M average
6M average
12M average
suggested budget
included in forecast
excluded from forecast
```

### 9.6 Rules: `/rules`

Purpose: manage deterministic categorization.

Features:

```text
list rules by priority
create rule
edit rule
disable rule
preview rule impact
apply rule to history
```

Historical application must not overwrite manual overrides.

### 9.7 Recurring: `/recurring`

Purpose: inspect subscriptions and fixed commitments.

Show:

```text
name
amount or amount range
cadence
next expected date
category
confidence
confirmed or detected
```

Warnings:

```text
new recurring payment detected
amount changed
expected payment missing
payment arrived earlier than usual
payment arrived later than usual
```

### 9.8 Export: `/export`

Purpose: generate and download XLSX budget exports.

Features:

```text
generate current export
download latest export
show previous export runs
show export errors
```

Downloads stream XLSX blobs from Postgres.

### 9.9 Settings: `/settings`

Purpose: configure assumptions.

Settings:

```text
accounts
salary day
target monthly savings
safety buffer
baseline window preferences
category taxonomy
sync schedule
LLM enabled or disabled
LLM confidence threshold
```

### 9.10 Admin/status: `/status`

Purpose: make local operation boring.

Show:

```text
app version
current git SHA if available
database migration version
last sync run
last forecast update
worker/job status
LLM enabled
LLM base URL
LLM model ref
latest export status
```

## 10. XLSX export

Filename:

```text
budget-averages-YYYY-MM.xlsx
```

Required sheets:

```text
1. Summary
2. Category averages
3. Monthly history
4. Recurring expenses
5. Excluded one-offs
6. Raw transactions
7. Rules
8. Forecast assumptions
```

Storage:

```text
generated XLSX files are stored in Postgres as bytea
export metadata is stored in export_runs
file bytes and checksums are stored in export_files
downloads stream the blob from Postgres
```

Do not store generated XLSX files permanently on local disk or inside the container filesystem.

Temporary files are allowed during generation only if the XLSX library needs them. They must be cleaned up after the blob is stored.

### 10.1 Summary sheet

Fields:

```text
generated_at
period covered
target savings
safety buffer
safe to spend
projected savings
forecast confidence
```

### 10.2 Category averages sheet

Columns:

```text
Category
3M average
6M average
12M average
Current month
Suggested budget
Included in forecast
Notes
```

Suggested budget MVP rule:

```text
suggested_budget = round_up(max(3M average, 6M average), nearest 5 or 10 euros)
```

### 10.3 Monthly history sheet

Columns:

```text
Month
Income
Fixed costs
Variable costs
Savings
Excluded spending
Net cashflow
```

### 10.4 Recurring expenses sheet

Columns:

```text
Name
Category
Cadence
Expected amount
Next expected date
Confidence
Confirmed
```

### 10.5 Excluded one-offs sheet

Columns:

```text
Date
Amount
Merchant
Description
Category
Reason
```

### 10.6 Raw transactions sheet

Include enough raw data for troubleshooting.

Do not include secrets.

## 11. Background jobs

Use `pgqueuer`.

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

### 11.1 `sync_abn_transactions`

Responsibilities:

```text
connect through ABN adapter
fetch recent mutations
insert raw transactions idempotently
record sync run status
enqueue normalization for new transactions
```

### 11.2 `normalize_transactions`

Responsibilities:

```text
create enriched transaction rows
normalize text fields
extract candidate merchant text
set obvious flags where safe
```

### 11.3 `classify_transactions`

Responsibilities:

```text
run categorization pipeline
store method, confidence, and reason
mark uncertain transactions for review
```

### 11.4 `detect_recurring`

Responsibilities:

```text
scan historical transactions
detect monthly or periodic payments
create or update recurring series
link transactions to recurring series
```

### 11.5 `update_monthly_forecast`

Responsibilities:

```text
compute current month forecast
store explanation JSON
update dashboard data
```

### 11.6 `generate_xlsx_export`

Responsibilities:

```text
generate workbook
store export run metadata
store workbook in Postgres bytea
store sha256 checksum
record export errors
```

### 11.7 `backfill_rule`

Responsibilities:

```text
apply rule to matching historical transactions
record changed transaction count
skip manual overrides
enqueue forecast update
```

## 12. PWA and static assets

Required PWA basics:

```text
web app manifest
mobile viewport
installable icon placeholders
basic service worker
static asset caching
offline fallback
dashboard can show last known summary when offline
```

Static-file policy:

```text
local dev uses Flask static serving
packaged web image uses WhiteNoise
do not add Caddy for static files
do not add nginx for static files
do not require a frontend build pipeline
```

Offline support is convenience only.

Important auth constraint:

```text
offline mode must not expose sensitive financial data before authentication
cached pages should avoid storing full transaction details
prefer caching app shell and static assets
dashboard offline fallback may show stale summary only after a valid authenticated session
```

For MVP, do not build full offline writes.

## 13. Security and privacy

Security model:

```text
Flask-OIDC protects the app.
The app is intended for one primary user.
No Caddy basic auth.
No local password auth.
No public registration.
No payment initiation.
Bank access is read-only from the app’s perspective.
```

Deployment boundary:

```text
the app provides an authenticated web process
the app provides a worker process
the app provides migration/admin commands
the app provides a container image
the app does not define TLS, reverse proxy, ingress, firewall, or backup strategy
the app does not assume any specific production orchestrator
```

Authentication requirements:

```text
use Flask-OIDC for login in normal runtime
protect all app routes by default
allow only explicitly public routes such as health checks and static assets
store authenticated user identity in request context
support an allowed-user or allowed-email configuration
deny access to authenticated users not in the allowlist
provide logout route if supported cleanly by the OIDC setup
```

Development and test auth requirements:

```text
dev and test use OIDC_TESTING_PROFILE
dev and test do not require a live identity provider
dev and test set OIDC_ENABLED=false
test profile must still pass the same allowed-email logic
E2E tests must run through the same test-profile auth path
```

Required practices:

```text
store secrets in env vars or mounted secret files
do not commit OIDC client secrets
do not log ID tokens, access tokens, or refresh tokens
do not log bank credentials
do not log full raw bank payloads at info level
sanitize UI error messages
use CSRF protection for state-changing forms
isolate bank adapter behind an interface
do not store bank passcodes in plaintext in the database
restrict exported XLSX downloads to authenticated allowed user
```

Session requirements:

```text
secure cookies in normal runtime
SameSite=Lax or stricter unless OIDC flow requires otherwise
HTTPOnly cookies
short enough session lifetime for financial data
clear session on logout
```

MCP safety requirement:

```text
Chrome DevTools MCP must only be used with fake/sample data during development.
Do not expose real financial data to MCP browser inspection sessions.
```

## 14. Testing strategy

Testing is not a late hardening phase. It starts at Phase 0.

Required test layers:

```text
unit tests
plain SQL migration tests
Postgres integration tests
job tests
classification pipeline tests
forecast calculation tests
XLSX export tests
Flask route tests
Puppeteer E2E tests
smoke tests for Docker image commands
```

### 14.1 Python tests

Use pytest.

Required baseline commands:

```text
uv run pytest
uv run pytest tests/unit
uv run pytest tests/integration
```

Expectations:

```text
business logic should have unit tests
database behavior should have integration tests against Postgres
migrations should be tested from an empty database
forecast math should be covered with deterministic fixtures
classification ordering should be covered explicitly
manual overrides must have regression tests
idempotent import must have regression tests
XLSX generation must verify workbook structure and key values
```

### 14.2 Puppeteer E2E tests

Puppeteer tests exist from the beginning.

They should run against the real Flask app in docker compose or a CI test compose setup.

Required baseline E2E flows:

```text
dashboard renders with sample data
transactions screen filters current-month transactions
review inbox accepts a suggested category
manual category edit persists
rule creation previews impact before applying
safe-to-spend changes after categorization update
export can be generated and downloaded
mobile viewport dashboard remains usable
```

E2E tests use:

```text
OIDC_ENABLED=false
OIDC_TESTING_PROFILE_JSON with a valid allowed email
sample data fixture
fake bank adapter
fake or deterministic LLM adapter by default
```

At least one optional local smoke test may hit the real local llama runtime, but CI should not depend on downloading or running the full model unless explicitly configured.

### 14.3 Test data

Create deterministic sample data covering:

```text
salary income
rent or mortgage
utilities
insurance
subscriptions
groceries
eating out
dog expenses
transport
large one-off purchase
transfer between own accounts
savings transfer
unknown transaction requiring review
recurring payment amount change
missing expected recurring payment
```

Sample data must not contain real financial details.

### 14.4 Coverage expectations

No exact percentage target for MVP, but the coverage should be heavy enough that Codex cannot make blind changes safely.

Coverage priorities:

```text
forecast formula
classification priority order
manual override behavior
idempotent imports
rule preview and backfill
export blob storage and download
route auth behavior
E2E happy paths
```

Every implementation phase must add or update tests.

A task is not complete if it introduces user-visible behavior without either route tests, integration tests, or Puppeteer E2E coverage as appropriate.

## 15. Observability

Keep it simple.

Admin-visible sync status should show:

```text
last sync time
new transactions imported
transactions classified
transactions needing review
last error, if any
job status
```

Logs should include:

```text
job started
job completed
new transaction count
classification counts by method
forecast recalculated
export generated
sanitized errors
```

Logs must go to stdout/stderr.

Do not add external observability services for MVP.

## 16. Acceptance criteria for MVP

MVP is done when:

1. A private instance can import ABN transactions.
2. Re-running import does not duplicate transactions.
3. Dashboard shows safe-to-spend, safe-per-day, projected savings, and confidence.
4. Transactions can be categorized through rules and manual corrections.
5. Low-confidence or unknown transactions appear in the review inbox.
6. User corrections can create reusable rules.
7. Recurring payments are detected and shown.
8. Current-month forecast updates after sync and review actions.
9. XLSX export generates the required sheets.
10. Generated XLSX exports are stored as Postgres blobs.
11. Previous XLSX exports can be downloaded from Postgres.
12. The app is usable on a mobile browser.
13. The app is protected by Flask-OIDC in normal runtime.
14. Development and tests use OIDC_TESTING_PROFILE.
15. Unit, integration, and Puppeteer E2E tests cover core flows.
16. Codex UI work is supported by Chrome DevTools MCP instructions.
17. The Docker image can run web, worker, and migrate commands.
18. The image is pushed to GHCR by CI.
19. No multi-user product features exist.
20. No Caddy dev setup exists.

## 17. Implementation plan for Codex

Implement in small vertical slices.

Each task should leave the app runnable and tested.

Tests are added from the start, not in a final cleanup sprint.

### Phase 0: Repository foundation

#### Task 0.1: Create modern Python project skeleton

Deliverables:

```text
pyproject.toml
uv.lock
app package layout
Flask app factory
config loading from env vars
basic route for /
template layout
Pico CSS included
HTMX included
static assets directory
README with local run instructions
```

Acceptance criteria:

```text
uv sync works
uv run python -m app.web starts the web app
/ returns HTML after test-profile auth
layout renders on mobile width
basic pytest smoke test passes
```

#### Task 0.2: Add quality tooling

Deliverables:

```text
ruff config
ty config
pytest config
basic smoke test
README commands
```

Acceptance criteria:

```text
uv run ruff check . passes
uv run ruff format --check . passes
uv run ty check passes
uv run pytest passes
```

#### Task 0.3: Add docker compose local development

Deliverables:

```text
docker-compose.yml
app service
worker service
postgres service
llama service
shared env configuration
volume for local Postgres data
volume/cache for model files
README instructions
```

Acceptance criteria:

```text
docker compose up starts app, worker, Postgres, and llama
no Caddy service exists
app is reachable directly on localhost
app can reach Postgres
worker can reach Postgres
app can reach llama runtime
llama runtime uses unsloth/gemma-4-E4B-it-GGUF
compose file is clearly documented as local-dev only
```

#### Task 0.4: Add database connectivity using plain psycopg

Deliverables:

```text
psycopg connection helper
connection pool or simple managed connection layer
transaction helper
database URL config
health check command
```

Acceptance criteria:

```text
app connects to Postgres using psycopg
worker connects to Postgres using psycopg
database operations are explicit SQL
no ORM is introduced
integration test verifies DB connection
```

#### Task 0.5: Add hand-rolled SQL migration system

Deliverables:

```text
migrations directory
schema_migrations table
migration runner command
up-only SQL migration files
idempotent migration tracking
README documentation
migration tests
```

Acceptance criteria:

```text
uv run python -m app.migrate applies migrations
migrations apply from clean database
already-applied migrations are skipped
migration failure exits non-zero with clear error
plain SQL files are the source of truth
pytest migration test passes against Postgres
```

Suggested migration layout:

```text
migrations/
  0001_initial.sql
  0002_seed_categories.sql
```

Suggested table:

```sql
CREATE TABLE IF NOT EXISTS schema_migrations (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);
```

#### Task 0.6: Add Flask-OIDC authentication foundation

Deliverables:

```text
Flask-OIDC initialization
OIDC config loading
OIDC_TESTING_PROFILE_JSON parsing
login route if needed
logout route if practical
route protection helper
allowed email/user check
test auth profile support
```

Acceptance criteria:

```text
all app routes require auth by default
static assets and health route remain accessible as intended
normal runtime supports real OIDC config
dev and test use OIDC_TESTING_PROFILE
test profile still goes through allowed-email logic
auth route tests pass
no local password auth exists
no Caddy/basic-auth dependency exists
```

#### Task 0.7: Add packaged image static handling

Deliverables:

```text
WhiteNoise dependency
runtime static config
WSGI wrapping for packaged web image
cache header config
static prefix config
```

Acceptance criteria:

```text
packaged web image serves static assets through WhiteNoise
dev app does not need WhiteNoise behavior
dev app does not need Caddy
static assets load from the image
route/static tests pass
```

#### Task 0.8: Add background job foundation

Deliverables:

```text
pgqueuer wiring
worker entrypoint
example no-op job
basic job status visibility
job tests
```

Acceptance criteria:

```text
worker runs through docker compose
worker can run from the same image as the web process
no-op job can be enqueued and completed
job test passes
```

#### Task 0.9: Add Docker image build

Deliverables:

```text
Dockerfile
.dockerignore
non-root runtime user
uv-based dependency install
web command
worker command
migration command
healthcheck command or endpoint
README image usage docs
```

Acceptance criteria:

```text
docker build succeeds
image starts web process
image starts worker process
image can run migrations
image does not contain local .env files
image does not contain bank credentials
image does not require writable application directory
smoke test verifies image command behavior
```

#### Task 0.10: Add GHCR publishing workflow

Deliverables:

```text
GitHub Actions workflow
build image on main branch
build image on tags
push image to GHCR
tag image by git SHA
optionally tag latest from main
run tests/lint/typecheck before publishing
```

Acceptance criteria:

```text
workflow runs uv sync
workflow runs ruff
workflow runs ty
workflow runs pytest
workflow runs Puppeteer E2E tests
workflow builds Docker image
workflow pushes image to GHCR only after checks pass
```

#### Task 0.11: Add Puppeteer E2E foundation

Deliverables:

```text
e2e/package.json
e2e/package-lock.json
Puppeteer test runner setup
E2E app URL config
OIDC test profile env config
sample-data loading hook
first dashboard smoke test
mobile viewport smoke test
```

Acceptance criteria:

```text
npm ci --prefix e2e works
npm test --prefix e2e works
E2E tests run against local app
E2E tests use OIDC_TESTING_PROFILE
E2E tests do not require real OIDC provider
E2E tests do not use real financial data
dashboard smoke test passes
mobile viewport smoke test passes
```

#### Task 0.12: Add sample data mode

Deliverables:

```text
sample data fixture
command to load sample data
fake bank adapter fixture
fake deterministic LLM classifier fixture
README docs
```

Acceptance criteria:

```text
sample data can be loaded into empty database
sample dashboard has meaningful numbers
sample review inbox has at least one item
Puppeteer tests use sample data
```

#### Task 0.13: Add Codex agent instructions

Deliverables:

```text
AGENTS.md
Chrome DevTools MCP usage guidance
UI development checklist
sample-data-only warning for MCP sessions
Puppeteer requirement for UI acceptance
```

Acceptance criteria:

```text
AGENTS.md instructs Codex to use Chrome DevTools MCP for UI tasks
AGENTS.md forbids exposing real financial data to MCP browser sessions
AGENTS.md says UI work is incomplete without route/integration/E2E coverage as appropriate
```

### Phase 1: Data model and import

#### Task 1.1: Create core tables

Deliverables:

```text
accounts
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

Acceptance criteria:

```text
migrations create all tables
basic constraints and indexes exist
seed categories command exists
migration tests cover clean database setup
```

#### Task 1.2: Define bank adapter interface

Deliverables:

```text
bank sync provider interface
ABN adapter wrapping abna
fake adapter for dev and tests
sample transaction fixtures
```

Acceptance criteria:

```text
fake adapter returns sample transactions
ABN adapter is isolated
app logic does not import abna directly
unit tests cover adapter normalization contract
```

#### Task 1.3: Implement raw transaction import

Deliverables:

```text
sync job using adapter
idempotent insert using stable source hash
sync run status
transaction count reporting
import tests
```

Acceptance criteria:

```text
same fixture imported twice creates no duplicates
new transactions are inserted
sync errors are recorded safely
unit/integration tests pass
```

### Phase 2: Normalization and categorization

#### Task 2.1: Normalize transactions

Deliverables:

```text
normalization job
enriched transaction creation
normalized text helpers
normalization tests
```

Acceptance criteria:

```text
every raw transaction has one enriched transaction
normalization can be safely re-run
normalization tests cover noisy transaction text
```

#### Task 2.2: Seed category taxonomy

Deliverables:

```text
seed command or migration
category list page or settings section
category tests
```

Acceptance criteria:

```text
categories exist in clean database
transactions can reference categories
seed command is idempotent
```

#### Task 2.3: Implement manual transaction editing

Deliverables:

```text
edit category
edit merchant
edit flags
mark needs_review false
store manual override
route tests
E2E test for manual edit
```

Acceptance criteria:

```text
manual edits persist
manual edits beat automated classification
route tests pass
Puppeteer manual edit flow passes
```

#### Task 2.4: Implement rules engine

Deliverables:

```text
rule matching engine
priority ordering
contains, exact, regex, starts_with, ends_with, amount_between
classification result includes rule id and reason
rule tests
```

Acceptance criteria:

```text
rules classify matching transactions
higher-priority rules win
manual overrides still win
rule tests cover every operator
```

#### Task 2.5: Implement merchant aliases

Deliverables:

```text
merchant alias matching
create merchant from transaction flow
apply default category from merchant
alias tests
```

Acceptance criteria:

```text
alias maps noisy descriptions to canonical merchant
merchant default category can classify transaction
tests cover multiple aliases for one merchant
```

#### Task 2.6: Implement historical similarity

Deliverables:

```text
simple similarity scoring
suggest category from manually corrected transactions
configurable confidence threshold
similarity tests
```

Acceptance criteria:

```text
similar past corrections produce suggestions
low-score transactions remain needs_review
tests cover false-positive avoidance
```

#### Task 2.7: Add Gemma GGUF classifier through local llama runtime

Deliverables:

```text
llama classifier adapter boundary
OpenAI-compatible HTTP client
prompt builder with closed category vocabulary
JSON parser and validator
feature flag to enable or disable LLM classification
model ref config
timeout handling
error handling
classifier tests with fake HTTP responses
optional local llama smoke test
```

Required config:

```text
LLM_BASE_URL
LLM_MODEL
LLM_TIMEOUT_SECONDS
LLM_CLASSIFICATION_TEMPERATURE
LLM_ENABLED
```

Default model:

```text
unsloth/gemma-4-E4B-it-GGUF:UD-Q4_K_XL
```

Acceptance criteria:

```text
local dev uses unsloth/gemma-4-E4B-it-GGUF
runtime config defaults to unsloth/gemma-4-E4B-it-GGUF
invalid model output fails safely
invented categories are rejected
low-confidence results go to review
classification stores model ref, runtime, prompt version, and reason
classifier timeout does not break sync
LLM can be disabled without breaking the pipeline
tests cover invalid JSON, timeout, invented category, and valid classification
```

#### Task 2.8: Build review inbox

Deliverables:

```text
/review route
list transactions needing review
accept suggestion action
change category action
create rule from transaction action
apply to similar transactions action
route tests
Puppeteer review flow tests
```

Acceptance criteria:

```text
review inbox shows only relevant transactions
accepting suggestion removes item from inbox
changing transaction creates durable correction
Puppeteer review flow passes
```

### Phase 3: Recurring detection

#### Task 3.1: Detect recurring series

Deliverables:

```text
recurring detection job
monthly cadence detection
amount tolerance
confidence score
recurring tests
```

Acceptance criteria:

```text
known monthly fixture transactions form recurring series
irregular one-offs are not marked high confidence
tests cover amount changes and missing expected payment
```

#### Task 3.2: Build recurring screen

Deliverables:

```text
/recurring route
list detected recurring payments
confirm recurring series
disable recurring series
show next expected date
route tests
Puppeteer recurring screen smoke test
```

Acceptance criteria:

```text
screen shows amount, cadence, next date, confidence
disabled series no longer affects forecast
E2E smoke test passes
```

### Phase 4: Forecasting

#### Task 4.1: Implement category averages

Deliverables:

```text
3M averages
6M averages
12M averages
current month totals by category
exclusions for income, transfers, savings, one-offs
average tests
```

Acceptance criteria:

```text
averages match fixture data
excluded one-offs do not pollute averages
tests cover empty history and partial history
```

#### Task 4.2: Implement safe-to-spend calculation

Deliverables:

```text
forecast calculation service
safe_to_spend
safe_per_day
projected_savings
confidence
explanation JSON
forecast tests
```

Acceptance criteria:

```text
formula covered by tests
dashboard can display explanation
negative safe-to-spend handled clearly
confidence changes when review burden or stale sync changes
```

#### Task 4.3: Implement forecast update job

Deliverables:

```text
job recalculates current month
job enqueued after sync, classification, review, rule backfill
job tests
```

Acceptance criteria:

```text
forecast updates after relevant changes
latest forecast available to dashboard
job tests pass
```

### Phase 5: Main UI

UI tasks should use Chrome DevTools MCP during development and Puppeteer for acceptance.

#### Task 5.1: Build dashboard

Deliverables:

```text
/ dashboard
safe-to-spend card
safe-per-day card
projected savings card
confidence indicator
review count
last sync status
top variances
upcoming fixed costs
route tests
Puppeteer dashboard tests
```

Acceptance criteria:

```text
dashboard answers core question above the fold on mobile
stale sync or low confidence is visible
Puppeteer validates desktop and mobile viewport
Codex has inspected dashboard with Chrome DevTools MCP during UI work
```

#### Task 5.2: Build transactions screen

Deliverables:

```text
/transactions
filters
mobile cards
desktop table if practical
HTMX filter updates
inline edit actions
route tests
Puppeteer transaction filter/edit tests
```

Acceptance criteria:

```text
user can find current-month unknown transactions quickly
user can edit classification from this screen
Puppeteer verifies filters and edit flow
```

#### Task 5.3: Build month view

Deliverables:

```text
/month
category pace table
fixed costs paid and upcoming
income status
uncategorized impact
route tests
Puppeteer month view smoke test
```

Acceptance criteria:

```text
user can see which categories explain the forecast
category overspend is obvious
E2E smoke test passes
```

#### Task 5.4: Build rules UI

Deliverables:

```text
/rules
create, edit, disable rules
preview rule impact
apply rule to history via job
route tests
Puppeteer rule preview/apply tests
```

Acceptance criteria:

```text
rule preview happens before historical changes
rule application does not overwrite manual overrides
Puppeteer verifies preview before apply
```

#### Task 5.5: Build settings screen

Deliverables:

```text
/settings
target savings
safety buffer
salary day
sync settings
LLM toggle and threshold
route tests
Puppeteer settings smoke test
```

Acceptance criteria:

```text
forecast uses configured target savings and safety buffer
LLM can be disabled without breaking pipeline
settings changes are covered by route tests
```

#### Task 5.6: Build status screen

Deliverables:

```text
/status
migration version
last sync status
worker/job status
LLM config display
model ref display
latest export status
route tests
```

Acceptance criteria:

```text
status page helps debug local setup
status page does not expose secrets
route tests verify secret redaction
```

### Phase 6: XLSX export

#### Task 6.1: Implement export generation

Deliverables:

```text
workbook generator
required sheets
export_runs table usage
export_files table usage
Postgres bytea storage
sha256 checksum
download route that streams from Postgres
export tests
```

Acceptance criteria:

```text
workbook opens in Excel or LibreOffice
required sheets exist
category averages are correct for fixture data
generated XLSX is stored in Postgres
downloaded XLSX matches stored sha256
no durable export file is left on container disk
export tests pass
```

#### Task 6.2: Build export screen

Deliverables:

```text
/export
generate export action
latest export download
export history
failed export status
route tests
Puppeteer export flow test
```

Acceptance criteria:

```text
user can generate and download budget averages
previous exports are visible
previous exports can be downloaded from Postgres
failed export is visible and recoverable
Puppeteer verifies export generation and download
```

### Phase 7: PWA and runtime packaging

#### Task 7.1: Add PWA basics

Deliverables:

```text
manifest
icons or placeholders
service worker
offline fallback
cached static assets
PWA tests where practical
Puppeteer installability/offline smoke test where practical
```

Acceptance criteria:

```text
app is installable on mobile
dashboard shell loads when offline
sensitive transaction details are not blindly cached
```

#### Task 7.2: Finalize packaged web image behavior

Deliverables:

```text
WhiteNoise runtime config
static asset directory convention
cache config
image startup command docs
env var docs
```

Acceptance criteria:

```text
web image serves static files through WhiteNoise
image does not need Caddy, nginx, or external static hosting
all runtime config comes from env vars
static smoke tests pass
```

#### Task 7.3: Finalize 12-factor container behavior

Deliverables:

```text
stdout/stderr logging
env-only config
non-root user
stateless container filesystem behavior
separate web/worker/migrate commands
health endpoint
clear startup failure for missing config
container smoke tests
```

Acceptance criteria:

```text
same image can run web, worker, and migrate commands
container can be stopped and replaced without losing application state
durable application state is in Postgres
generated XLSX files survive container replacement because they are stored in Postgres
```

#### Task 7.4: Finalize GHCR artifact

Deliverables:

```text
GHCR publishing workflow
README section for pulling/running the image
documented required env vars
documented process commands
```

Acceptance criteria:

```text
image is published to GHCR
image tag includes git SHA
image can be run outside docker compose with supplied env vars
README does not prescribe production infrastructure
```

### Phase 8: Coverage and hardening pass

This phase is not where tests begin. It is where gaps are closed.

#### Task 8.1: Coverage audit

Deliverables:

```text
list of critical flows
mapping from critical flows to tests
identified gaps
gap-filling tests
```

Acceptance criteria:

```text
forecast formula has meaningful coverage
classification priority order has meaningful coverage
manual override behavior has meaningful coverage
idempotent imports have meaningful coverage
rule preview and backfill have meaningful coverage
export blob storage and download have meaningful coverage
route auth behavior has meaningful coverage
E2E happy paths exist for main screens
```

#### Task 8.2: E2E reliability pass

Deliverables:

```text
stable selectors
reduced flakiness
clear E2E setup docs
CI-friendly app startup/wait logic
screenshots or traces on failure if practical
```

Acceptance criteria:

```text
Puppeteer suite is stable locally
Puppeteer suite is stable in CI
failures produce useful debugging output
```

## 18. First vertical slice

Build this before touching real ABN sync or real XLSX complexity.

```text
1. docker compose starts app, worker, Postgres, and llama runtime.
2. docker compose does not include Caddy.
3. Flask app starts through uv run python -m app.web.
4. Flask-OIDC test mode protects the app via OIDC_TESTING_PROFILE.
5. Tests use OIDC_TESTING_PROFILE.
6. uv, ruff, ty, and pytest are wired.
7. Puppeteer E2E test harness is wired from the beginning.
8. Plain SQL migrations work through uv run python -m app.migrate.
9. Fake adapter imports sample transactions.
10. Raw transactions are stored idempotently.
11. Enriched transactions are created.
12. Hardcoded rules categorize sample data.
13. Dashboard shows safe-to-spend from sample data.
14. Review inbox shows uncategorized transactions.
15. Puppeteer verifies dashboard and review inbox using sample data.
16. Llama classifier adapter can classify one sample transaction through the local runtime.
17. The classifier uses unsloth/gemma-4-E4B-it-GGUF.
18. Docker image builds successfully.
19. Same image can run web, worker, and migrate commands.
20. Static assets are served by the packaged image using WhiteNoise.
21. GHCR publish workflow exists.
22. AGENTS.md tells Codex to use Chrome DevTools MCP for UI work.
```

This proves the app shape, runtime shape, local dev loop, auth test path, and UI test path before adding the fiddly real bank integration.

## 19. Open decisions for stack iteration

These are intentionally not decided yet:

```text
psycopg connection pooling approach
exact SQL migration runner behavior
whether migrations are auto-run at web startup or explicit command only
form handling approach
CSRF approach
ABN credential handling
current balance source
exact llama server image
exact model quantization if not UD-Q4_K_XL
category taxonomy details
rounding policy for suggested budgets
how strict the OIDC allowed-user check should be
whether local dev can optionally use real OIDC instead of test profile
whether CI should ever run an optional real-llama smoke test
Puppeteer package layout details beyond e2e/ npm basics
```

No longer open:

```text
Python package manager: uv
linter/formatter: ruff
type checker: ty
test runner: pytest
E2E runner: Puppeteer
database access: plain psycopg
migration approach: hand-rolled SQL
local dev orchestration: docker compose
local dev reverse proxy: none
auth framework: Flask-OIDC
dev/test auth path: OIDC_TESTING_PROFILE
packaged static files: WhiteNoise
runtime artifact: Docker/OCI image
image registry: GHCR
LLM model repo: unsloth/gemma-4-E4B-it-GGUF
XLSX export storage: Postgres bytea blobs
Codex UI aid: Chrome DevTools MCP
```

## 20. Notes for Codex

When implementing:

```text
Prefer small commits.
Keep the app runnable after each task.
Keep the test suite green after each task.
Use docker compose as the default local dev path.
Do not add Caddy to local dev.
Do not write production deployment guides.
Do not prescribe TLS, ingress, reverse proxy, or hosting setup.
Produce a 12-factor-style Docker image.
Publish the image to GHCR through CI.
Use env vars for runtime config.
Do not bake secrets into the image.
Do not rely on durable container filesystem state.
Store durable app data in Postgres.
Store generated XLSX files in Postgres as bytea blobs.
Use uv for Python dependency and command management.
Use ruff for linting and formatting.
Use ty for type checking.
Use pytest for Python tests.
Use Puppeteer for E2E tests from the beginning.
Use OIDC_TESTING_PROFILE for dev and tests.
Use Chrome DevTools MCP for UI development.
Use sample data only when browser/MCP tooling is involved.
Use plain psycopg and explicit SQL.
Use hand-rolled SQL migrations.
Use fake data before real bank integration.
Use Flask-OIDC for app auth.
Use WhiteNoise for packaged static files.
Do not introduce local username/password auth.
Do not introduce multi-user product features.
Do not introduce a frontend build pipeline.
Do not let the LLM create categories.
Do not overwrite manual overrides.
Do not duplicate imported transactions.
Keep explanations visible in the UI.
Keep local and packaged LLM behavior as similar as practical.
Use unsloth/gemma-4-E4B-it-GGUF for classification.
```

## 21. Recommended repo files

Initial repo shape:

```text
.
  AGENTS.md
  Dockerfile
  README.md
  docker-compose.yml
  pyproject.toml
  uv.lock
  migrations/
    0001_initial.sql
    0002_seed_categories.sql
  app/
    __init__.py
    web.py
    worker.py
    migrate.py
    admin.py
    config.py
    db.py
    auth.py
    templates/
    static/
    bank/
    classify/
    forecast/
    exports/
    jobs/
  tests/
    unit/
    integration/
  e2e/
    package.json
    package-lock.json
    tests/
  .github/
    workflows/
      ci.yml
      image.yml
```
