# Coverage Audit

This audit maps the PRD critical flows to the current automated coverage. It is intentionally specific to test files so future slices can update evidence instead of relying on broad claims.

## Critical Flow Map

| Flow | Evidence |
| --- | --- |
| Forecast formula and safe-to-spend math | `tests/unit/forecast/test_calculator.py`, `tests/integration/test_forecast_service.py`, `tests/integration/test_month_routes.py`, `e2e/tests/dashboard-review.spec.mjs` dashboard and month tests |
| Forecast confidence from review and sync freshness | `tests/integration/test_forecast_service.py`, `tests/integration/test_sample_data.py`, dashboard E2E in `e2e/tests/dashboard-review.spec.mjs` |
| Classification priority order | `tests/unit/classify/test_pipeline.py`, `tests/integration/test_classify_service.py` |
| Manual overrides and review correction | `tests/integration/test_review_actions.py`, `tests/integration/test_rule_routes.py`, `tests/integration/test_transaction_routes.py`, review and transaction E2E in `e2e/tests/dashboard-review.spec.mjs` |
| Merchant aliases from review | `tests/integration/test_review_actions.py`, alias classifier coverage in `tests/unit/classify/test_pipeline.py` |
| Historical similarity suggestions | `tests/unit/classify/test_pipeline.py`, `tests/integration/test_classify_service.py` |
| Recurring classifier ordering before historical and LLM fallback | `tests/unit/classify/test_pipeline.py`, `tests/integration/test_classify_service.py` |
| Local llama fallback behavior | `tests/unit/classify/test_llm.py`, `tests/integration/test_classify_service.py`, settings route tests |
| Idempotent bank import and normalization | `tests/integration/test_bank_sync.py`, `tests/integration/test_normalize.py`, `tests/unit/bank/test_abn.py` |
| Configured sync lookback window | `tests/integration/test_bank_sync.py`, `tests/unit/test_sync_job.py` |
| Recurring detection and confirmation | `tests/integration/test_recurring.py`, recurring E2E in `e2e/tests/dashboard-review.spec.mjs` |
| Rule preview and historical backfill | `tests/integration/test_rule_routes.py`, rule E2E in `e2e/tests/dashboard-review.spec.mjs` |
| Rule create, edit, disable UI | `tests/integration/test_rule_routes.py`, rule E2E in `e2e/tests/dashboard-review.spec.mjs` |
| XLSX generation, blob storage, and download | `tests/integration/test_exports.py`, export E2E in `e2e/tests/dashboard-review.spec.mjs` |
| Failed export visibility and recovery | `tests/integration/test_exports.py` |
| Auth, logout, and allowed-user behavior | `tests/unit/test_web.py`, route tests using `OIDC_TESTING_PROFILE_JSON`, CSRF checks in review/rule/settings/export route tests |
| Session lifetime configuration | `tests/unit/test_config.py`, `tests/unit/test_web.py` |
| PWA installability and offline shell | `tests/unit/test_pwa.py`, PWA E2E in `e2e/tests/dashboard-review.spec.mjs` |
| Mobile UX and no horizontal overflow | mobile E2E assertions across dashboard, month, review, transactions, categories, settings, export, and recurring |
| Worker observability logs | `tests/integration/test_jobs.py` |
| Runtime env defaults and retention settings | `tests/unit/test_config.py`, `tests/integration/test_settings_routes.py`, `tests/integration/test_exports.py`, `tests/integration/test_status_routes.py` |
| Docker image command behavior | static checks in `tests/unit/test_container_runtime.py`, opt-in image smoke in `tests/integration/test_docker_image.py`, CI workflow invocation |
| GHCR workflow behavior | `tests/unit/test_ci_workflow.py`, `.github/workflows/ci.yml` |
| Runtime version and git SHA visibility | `tests/unit/test_config.py`, `tests/unit/test_container_runtime.py`, `tests/unit/test_ci_workflow.py`, `tests/integration/test_status_routes.py`, status E2E in `e2e/tests/dashboard-review.spec.mjs` |

## Gaps Found And Filled

- PWA root-scope offline behavior was previously only unit-tested. Added a root `/service-worker.js` route and Puppeteer installability/offline coverage.
- Docker image behavior was previously static-only. Added an opt-in smoke test that builds the image, runs migrations, serves packaged web/static assets, and starts the worker against Testcontainers Postgres.
- Merchant alias creation existed only as classifier support. Added a review-form flow and coverage for creating or skipping aliases.
- E2E failures previously had no visual artifacts. Added screenshot and stack capture under `E2E_ARTIFACT_DIR` or `/tmp/treasuri-e2e-artifacts`.
- Forecast confidence previously ignored stale sync state. Added sync-freshness confidence reasons and dashboard visibility.
- The transactions screen previously filtered only. Added manual edit coverage from `/transactions` itself.
- Transaction filters previously covered only search, month, category, and review state. Added explicit merchant,
  uncategorized, amount-range, and transaction-type filters for income, transfers, recurring, excluded, and related flags.
- Transaction rows previously had no source-level troubleshooting action. Added raw transaction detail pages and row links with route and E2E coverage.
- Transaction corrections previously edited only category and merchant. Added transfer, savings, one-off, and budget-exclusion flag editing with route and E2E coverage.
- Review corrections previously handled only one transaction or rule preview. Added apply-to-similar review corrections that skip existing manual overrides.
- The rules screen previously lacked direct create/edit forms and flag controls. Added rule editor coverage for category,
  merchant, and rule-set flags while keeping preview before historical backfill.
- The dashboard previously omitted top category variances. Added dashboard variance visibility with sample-data and E2E assertions.
- Forecast settings previously exposed only money assumptions. Added salary-day, baseline-month, and sync-lookback controls with route and E2E coverage.
- Settings previously hid operational context. Added account, category taxonomy, and sync schedule readouts with route and E2E coverage.
- XLSX recurring expenses previously exported only headers. Added recurring-series rows and workbook value assertions.
- Export failure handling previously showed failed runs but did not prove recovery. Added a Testcontainers-backed route test that keeps the failed run visible, generates a new workbook, drains the worker, and downloads the recovered Postgres blob.
- Worker logs previously emitted ad hoc summaries. Added structured stdout logs for job start, completion, sanitized failure, classification method counts, forecast recalculation, and generated exports.
- Auth previously lacked an explicit sign-out path and bounded session lifetime. Added logout route coverage, public signed-out page coverage, and session lifetime configuration tests.
- Runtime identity previously was not visible in the artifact. Added app version and git SHA configuration, image build args, CI build-arg coverage, and status-page visibility.
- Sync lookback days previously appeared in settings without constraining fetched mutations. Added sync filtering, metadata, worker logging, and tests that prove the saved setting reaches foreground and worker sync paths.
- `SYNC_LOOKBACK_DAYS` and `EXPORT_RETENTION_DAYS` previously existed only in the PRD runtime contract. Added env-backed defaults, retention pruning for old finished exports, status visibility, and Testcontainers coverage.
- The classification pipeline previously skipped the PRD's recurring matcher stage. Added recurring-series matching before historical similarity and LLM fallback, including persistence of recurring flags and series links.

## Residual Risk

- ABN AMRO integration tests use adapter fixtures, not live bank credentials. This keeps tests deterministic and avoids real financial data.
- Local llama runtime smoke remains represented by unit/integration fakes. CI intentionally does not download or run the full GGUF model.
- Chrome in this WSL environment cannot render the `💸` emoji glyph, but the DOM, favicon SVG, and manifest use the native emoji; normal platform emoji fonts should render it.
