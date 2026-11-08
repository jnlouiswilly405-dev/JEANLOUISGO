# JEANLOUISGO Recovery v44 — Runtime Health Checks

## Change
- Kept `/health` as a lightweight process-liveness endpoint for compatibility.
- Added `/health/live` as an explicit liveness endpoint.
- Added `/health/ready`, which returns HTTP 200 only when `DATABASE_URL` is configured and PostgreSQL responds to `SELECT 1`; otherwise it returns HTTP 503 without exposing connection details.
- This allows hosting/orchestration to distinguish a running API process from an API that can safely receive database-dependent traffic.

## Remaining release gates
- Static QA and TypeScript compilation/runtime tests still need to run in an environment with dependencies installed.
- PostgreSQL migrations and `/health/ready` must be exercised against a real PostgreSQL service in CI.
- The settlement outbox worker exists as a service but is not wired into the server process; a concrete idempotent handler and operational worker lifecycle are still required.
- Stripe raw-body signature verification and the real provider adapter remain incomplete. Live payments must stay disabled.
- Customer, driver, merchant, and admin frontends remain placeholders.
- GitHub write access remains blocked by integration HTTP 403; no branch push or workflow run is claimed.

## Validation meaning
Static QA validates repository assertions only. It does not certify runtime, database, or production behavior.
