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
| Local llama fallback behavior | `tests/unit/classify/test_llm.py`, `tests/integration/test_classify_service.py`, settings route tests |
| Idempotent bank import and normalization | `tests/integration/test_bank_sync.py`, `tests/integration/test_normalize.py`, `tests/unit/bank/test_abn.py` |
| Recurring detection and confirmation | `tests/integration/test_recurring.py`, recurring E2E in `e2e/tests/dashboard-review.spec.mjs` |
| Rule preview and historical backfill | `tests/integration/test_rule_routes.py`, rule E2E in `e2e/tests/dashboard-review.spec.mjs` |
| Rule create, edit, disable UI | `tests/integration/test_rule_routes.py`, rule E2E in `e2e/tests/dashboard-review.spec.mjs` |
| XLSX generation, blob storage, and download | `tests/integration/test_exports.py`, export E2E in `e2e/tests/dashboard-review.spec.mjs` |
| Auth and allowed-user behavior | `tests/unit/test_web.py`, route tests using `OIDC_TESTING_PROFILE_JSON`, CSRF checks in review/rule/settings/export route tests |
| PWA installability and offline shell | `tests/unit/test_pwa.py`, PWA E2E in `e2e/tests/dashboard-review.spec.mjs` |
| Mobile UX and no horizontal overflow | mobile E2E assertions across dashboard, month, review, transactions, categories, settings, export, and recurring |
| Docker image command behavior | static checks in `tests/unit/test_container_runtime.py`, opt-in image smoke in `tests/integration/test_docker_image.py`, CI workflow invocation |
| GHCR workflow behavior | `tests/unit/test_ci_workflow.py`, `.github/workflows/ci.yml` |

## Gaps Found And Filled

- PWA root-scope offline behavior was previously only unit-tested. Added a root `/service-worker.js` route and Puppeteer installability/offline coverage.
- Docker image behavior was previously static-only. Added an opt-in smoke test that builds the image, runs migrations, serves packaged web/static assets, and starts the worker against Testcontainers Postgres.
- Merchant alias creation existed only as classifier support. Added a review-form flow and coverage for creating or skipping aliases.
- E2E failures previously had no visual artifacts. Added screenshot and stack capture under `E2E_ARTIFACT_DIR` or `/tmp/treasuri-e2e-artifacts`.
- Forecast confidence previously ignored stale sync state. Added sync-freshness confidence reasons and dashboard visibility.
- The transactions screen previously filtered only. Added manual edit coverage from `/transactions` itself.
- The rules screen previously lacked direct create/edit forms. Added rule editor coverage while keeping preview before historical backfill.

## Residual Risk

- ABN AMRO integration tests use adapter fixtures, not live bank credentials. This keeps tests deterministic and avoids real financial data.
- Local llama runtime smoke remains represented by unit/integration fakes. CI intentionally does not download or run the full GGUF model.
- Chrome in this WSL environment cannot render the `💸` emoji glyph, but the DOM, favicon SVG, and manifest use the native emoji; normal platform emoji fonts should render it.
