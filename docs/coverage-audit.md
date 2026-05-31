# Coverage Audit

This audit maps PRD v2 critical behavior to the current automated checks. Keep it current as slices land.

## Current Evidence

| Flow | Evidence |
| --- | --- |
| Forecast formula and safe-to-spend math | `tests-ts/unit/server/forecast/calculator.test.ts`, `tests-ts/integration/dashboard/routes.test.ts`, `tests-e2e/dashboard.spec.ts` |
| React dashboard and current-month workspace | `src/client/dashboard/DashboardPage.tsx`, `tests-e2e/dashboard.spec.ts` |
| OIDC disabled local profile and allowed-email guard | `tests-ts/unit/server/auth/auth.test.ts`, `tests-ts/unit/server/http/app.test.ts` |
| Hand-rolled migrations from an empty database | `tests-ts/integration/migrations/migrate.test.ts`, `tests/integration/test_postgres_migrations.py` |
| Deterministic sample data | `tests-ts/integration/sample/load.test.ts` |
| Fake sync, idempotent import, normalization, and synced balances | `tests-ts/integration/bank/sync.test.ts`, `tests-ts/unit/server/bank/sourceHash.test.ts` |
| In-repo TypeScript ABN rewrite | `tests-ts/unit/server/bank/abn/client.test.ts`, `tests-ts/unit/server/bank/abn/parser.test.ts` |
| Classification priority and LLM fallback boundaries | `tests-ts/unit/server/classify/pipeline.test.ts`, `tests-ts/unit/server/classify/llm.test.ts` |
| Review inbox and manual correction workflow | `tests-ts/integration/review/routes.test.ts`, `tests-e2e/review.spec.ts` |
| Transactions, rules, categories, and recurring UI | `tests-ts/integration/management/routes.test.ts`, `tests-e2e/management.spec.ts` |
| Job payload validation and pg-boss status visibility | `tests-ts/unit/server/jobs/definitions.test.ts`, `tests-ts/integration/operations/routes.test.ts` |
| XLSX export blob storage and download | `tests-ts/integration/operations/routes.test.ts`, `tests-e2e/operations.spec.ts` |
| Settings only store user-controlled assumptions | `tests-ts/integration/operations/routes.test.ts`, `tests-e2e/operations.spec.ts` |
| Status redacts secrets | `tests-ts/integration/operations/routes.test.ts`, `tests-e2e/operations.spec.ts` |
| PWA manifest, service worker, and safe offline fallback | `tests-ts/unit/client/pwa-assets.test.ts`, `tests-e2e/pwa.spec.ts` |
| Desktop sidebar and mobile bottom navigation | `tests-e2e/shell.spec.ts` |
| Docker runtime shape | `tests/unit/test_container_runtime.py`, `Dockerfile`, `compose.yml` |
| CI, image build, image command smoke, and GHCR publish gate | `tests/unit/test_ci_workflow.py`, `.github/workflows/ci.yml` |

## Residual Risk

- ABN AMRO coverage is fixture-driven and does not use live credentials.
- The local llama runtime is represented through deterministic unit/integration boundaries; CI does not download the full model.
- Real production deployment architecture remains outside PRD v2 scope.
