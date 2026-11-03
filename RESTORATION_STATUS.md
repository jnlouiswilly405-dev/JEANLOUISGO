# JEANLOUISGO Restoration Status

## Recovery snapshot
- Release metadata: 1.1.1 (the internal source folder label `multigo-v0.6.0` remains a historical naming mismatch).
- Existing backend modules and database schema/migrations are preserved.
- Customer, driver, merchant and admin frontend folders remain placeholders; frontend source has not been restored.

## Payment safety hardening in this recovery snapshot
- Mock provider selection is explicit; the API no longer silently defaults to mock payments.
- Mock payment provider is rejected unless `NODE_ENV` is `test` or `development`.
- Idempotency keys cannot be reused for a different order, provider or amount.
- Partial refunds no longer mark the entire order as refunded.
- Unit tests cover the environment guard.

## Still not release-ready
- Stripe adapter remains a stub; no official Stripe PaymentIntent API or Stripe-Signature webhook verification is implemented.
- PostgreSQL migrations, database-backed integration tests, dependency installation and full backend build/tests are not verified in this environment.
- Frontend source is absent.
- GitHub write permission must be restored before this recovery snapshot can be pushed to a separate branch.

## Database migration consistency fix
- Corrected the admin financial summary view to select `orders.total_cents`, matching the canonical schema (the previous `total_amount` reference did not exist).
- Extended static QA to guard against reintroducing the `total_amount` mismatch.
- Static QA passes after this correction. The SQL migration still requires execution against PostgreSQL before it can be considered integration-verified.

## Additional order and production-configuration hardening
- Replaced stale order lifecycle tests that incorrectly called database-backed async functions as synchronous functions. The tests now target isolated transition and input-validation rules.
- Order status transitions now lock the order row inside a transaction (`SELECT ... FOR UPDATE`) before validating and updating, reducing concurrent transition races.
- Order input validation now rejects empty item lists, invalid quantities, missing product IDs, and negative/fractional delivery fees.
- Repeated product IDs across separate order lines are handled correctly when checking product availability.
- Order totals are checked for safe integer arithmetic and the PostgreSQL `INTEGER` storage ceiling before insert.
- Production startup now rejects the built-in development JWT secret and requires `DATABASE_URL`.
- Static QA passes. These tests have been authored but have not been executed because dependency installation timed out in this environment.


## Recovery v7 — order/dispatch consistency
- Order reads now expose the canonical driver profile reference (`driver_profile_id`) while retaining compatibility with the legacy `driver_id` column.
- Dispatch offers are restricted to orders in `READY`, matching the order lifecycle rather than dispatching immediately after payment.
- Rejecting an offered assignment restores the order to `READY`, clears its canonical driver profile, and releases the driver profile back to `AVAILABLE`.
- Static QA now checks these consistency rules.
- Automated TypeScript/Vitest and live PostgreSQL execution remain unverified until dependencies and a PostgreSQL service are available.


## Recovery v8 — dispatch acceptance integrity
- Acceptance now locks the assignment and order rows together.
- The order must still be `ASSIGNED`, and its `driver_profile_id` must match the driver accepting the offer.
- Static QA assertions cover both checks. Database concurrency and full test execution remain unverified pending PostgreSQL CI.

## Recovery v9 — stale dispatch rejection safety
- Rejection locks the assignment and order together.
- It releases the driver and reopens the order only when the rejecting driver still owns the current assignment.
- Static QA checks the guarded update; live PostgreSQL concurrency tests are still outstanding.

## Recovery v10 — authorization and ownership hardening
- Scoped order list/detail responses to the signed-in customer's, merchant owner's, or assigned driver's records (admin can view all).
- Restricted order status transitions by role and ownership.
- Added ownership checks for driver location writes, order tracking reads, and merchant settlement reads.
- Delivery status progression now verifies the order is assigned to the caller's driver profile.
- Static QA passes. Full TypeScript/Vitest and PostgreSQL tests remain unexecuted because dependencies and a PostgreSQL runtime are unavailable in this environment.

## Recovery v11 — atomic authorization and driver earnings
- Order authorization and status transition now occur under the same transaction and order-row lock.
- Driver earnings endpoint now validates the requested driver profile belongs to the authenticated DRIVER user; admin remains permitted.
- Static QA passes. Full build, unit/integration tests, PostgreSQL migration run, live payment provider verification, frontend recovery, and GitHub CI remain outstanding.


## Recovery v12 — payment ledger consistency
- Added a transaction-scoped PostgreSQL advisory lock for payment idempotency keys, protecting concurrent requests before the first payment row exists.
- Webhook and refund ledger entries now use the order currency rather than a hard-coded USD value.
- Static QA includes assertions for these changes. Runtime PostgreSQL concurrency/integration tests are still pending. Stripe remains a non-production stub.


## Recovery v13 — settlement ownership and payout integrity
- Settlement creation checks that merchant and driver profile IDs match the delivered order.
- Monetary inputs must be finite/non-negative and commission/fee values cannot exceed their gross basis.
- Finalized settlement rows cannot be silently overwritten during recalculation.
- Static QA assertions added; database runtime tests remain pending.

## Recovery v14 — settlement minor-unit and currency consistency
- Settlement service now accepts integer cents, verifies the gross equals the order total, and stores the order currency.
- Migration 014 adds exact BIGINT cents columns and backfills existing records from legacy decimal values and order currency.
- Legacy amount columns remain to avoid breaking older consumers. PostgreSQL migration and integration tests remain pending.


## Recovery v36 — CI runner prerequisite hardening
- Updated the PostgreSQL GitHub Actions workflow to explicitly install and verify `postgresql-client` before applying the schema and migrations.
- This avoids relying on the hosted runner image to include `psql` by default.
- Static QA passes locally; GitHub Actions execution is still blocked until repository write access is restored and this recovery branch can be pushed.

## Recovery v37 — payment release audit
- Reviewed payment routes, service, and provider adapter for real-money release readiness.
- Added `docs/PAYMENT_RELEASE_AUDIT_V37.md` documenting confirmed safeguards and remaining Stripe/webhook/transaction/reconciliation blockers.
- Live payments remain disabled; no production payment capability was enabled.
- This was a static source review. PostgreSQL integration tests and TypeScript/Vitest execution remain unverified in this environment.

## Recovery v38 — manual GitHub branch upload path
- Added `docs/GITHUB_RECOVERY_UPLOAD_V38.md` with GitHub Desktop and command-line steps to publish the full recovery source on `recovery/v38-upload` without modifying `main`.
- The connected GitHub integration was tested through both branch-creation and direct Git-ref update methods; both returned HTTP 403 `Resource not accessible by integration`.
- CI is configured to run on pushes to `recovery/**`; no GitHub Actions run has been claimed or recorded from this environment.
- Release gates remain: actual PostgreSQL CI, successful backend build/tests, real Stripe test-mode integration and webhook verification, and implementation of the four app frontends.


## Recovery v39 — CI runner hardening
- Restricted the PostgreSQL CI workflow token to `contents: read`.
- Added per-ref concurrency cancellation and a 25-minute job timeout.
- Preserved PostgreSQL 16, client installation, schema/migration execution, static QA, build, and test stages.
- Static QA passes locally. GitHub-hosted CI remains pending because branch/ref write access is currently denied by the GitHub integration (HTTP 403).

## Recovery v40 — migration ledger and safe reruns
- Updated `database/migrate.sh` to create a `schema_migrations` ledger and skip migrations already recorded.
- Each migration and its ledger insert run in one PostgreSQL transaction, preventing a failed migration from being marked applied.
- This prevents migrations such as the provider-scoped payment-event primary-key change from being blindly re-applied on later CI/deploy runs.
- Static QA was rerun. Live PostgreSQL execution is still pending because GitHub write access remains blocked and no PostgreSQL runtime has been verified here.

## Recovery v41 — migration runner correctness hardening
- Hardened `database/migrate.sh` to fail clearly if `psql` or migration files are missing.
- The migration SQL and its `schema_migrations` ledger insert are submitted in one explicit transaction, so a migration cannot commit without its ledger record.
- Preserved lexical migration ordering and skip behavior for already-recorded migrations.
- Validation: shell syntax and repository static QA pass. A live PostgreSQL run is still pending; GitHub integration write access remains blocked.


## Recovery v42 — final migration runner hardening
- Reworked the migration runner to use a stable project-root path, verify the PostgreSQL client and migration directory, and fail when no migrations are found.
- Disabled psql startup-file loading (`-X`) for deterministic CI behavior.
- Retained one-transaction-per-migration behavior with the migration ledger update in the same transaction.
- Reviewed the 12 migration files for embedded transaction-control statements; none were found.
- Static QA and shell syntax checks are recorded in the v42 validation report. Live PostgreSQL and GitHub Actions remain unverified because the integration still lacks repository write permission.


## Recovery v43 — environment audit and release gate
- Re-ran static QA after restoring the executable bit on `database/migrate.sh`: PASS.
- Verified migration runner shell syntax: PASS.
- Confirmed 12 ordered migration files and no embedded transaction-control statements.
- Added `docs/RECOVERY_V43_ENVIRONMENT_AUDIT.md` to make unavailable runtime checks explicit.
- PostgreSQL, npm build/tests, and GitHub Actions remain unexecuted in this workspace. Stripe live payments and frontend release remain blocked.


## Recovery v44 — service health and readiness
- Preserved `/health` as a liveness-compatible endpoint and added `/health/live`.
- Added `/health/ready`, which checks PostgreSQL with `SELECT 1` and returns HTTP 503 when the database is unavailable or unconfigured.
- Added `docs/RECOVERY_V44_HEALTH_CHECKS.md` with remaining runtime and release gates.
- Static QA is run after this change; database and TypeScript runtime validation remain pending.
