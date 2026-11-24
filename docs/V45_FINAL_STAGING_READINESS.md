# V45 final staging readiness and acceptance plan

This is a staging-only execution checklist, not deployment authorization.
Use synthetic accounts and test-mode Stripe credentials. Do not deploy to
production, enable live payments/refunds/Connect/payouts, or alter `main`.
Record the operator, date, candidate SHA, evidence link, outcome, and reviewer
for every check. A failed or inconclusive check blocks release.

## Candidate and release gates

- [ ] Confirm the candidate is the approved commit on
  `fix/v45-pilot-review-20261124`, with a clean worktree and a verified recovery
  package. Do not substitute `main` or an unreviewed branch.
- [ ] Confirm the candidate's PostgreSQL CI and Stripe Sandbox E2E are green.
  At commit `fecd31d278866f3da4fbf4de8d42de47ce13d16a`, both succeeded:
  [PostgreSQL CI](https://github.com/jnlouiswilly405-dev/JEANLOUISGO/actions/runs/45431341372)
  and
  [Stripe Sandbox E2E](https://github.com/jnlouiswilly405-dev/JEANLOUISGO/actions/runs/45431391224).
  They ran with the workflow's explicit `defer_migration_019=true` option;
  migration 019 was separately validated on disposable PostgreSQL 16.
- [ ] Record approvals and named owners for staging change, database, finance
  audit, monitoring/incident response, backup/restore, and rollback.
- [ ] Confirm staging is isolated from production data, credentials, networks,
  queues, email, payments, and payout systems. Use synthetic data only.
- [ ] Record the pre-change release SHA, build identifier, database migration
  list, backup identifier, and rollback decision point.

## Protected historical ledger audit and migration 019

Follow `HISTORICAL_LEDGER_AUDIT_019.md`. This is a financial control, not a
routine deployment step.

- [ ] Obtain written authorization naming the database/snapshot, purpose,
  read-only operator, finance reviewer, and audit window.
- [ ] Make and verify an encrypted backup; run the audit on a protected,
  access-controlled restored snapshot where possible. Do not place database
  URLs, credentials, customer details, or raw provider payloads in logs or
  reports.
- [ ] Connect with an approved read-only account; verify
  `BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY` succeeds and
  `transaction_read_only` is `on`. Run the duplicate-credit, unlinked-credit,
  succeeded-payment/credit pairing, amount/currency mismatch, and aggregate
  count queries from the linked procedure. Save only approved redacted findings.
- [ ] Stop on every anomaly. A finance owner must reconcile against provider
  records and document an approved resolution. Never delete, rewrite, net, or
  fabricate ledger records to make the index pass.
- [ ] Obtain written finance and database-owner sign-off on zero unresolved
  anomalies and a maintenance window before applying migration 019. Quiesce
  writes or use another owner-approved consistent cutover and recheck the
  actual target; a historical snapshot does not prove current data is clean.
- [ ] In staging, verify the expected schema version, apply the normal ordered
  migration once, and verify
  `idx_ledger_one_clearing_credit_per_order` exists with its exact partial
  predicate. Repeat the read-only duplicate count and verify zero.
- [ ] Capture migration output, before/after schema version, backup ID, and
  reviewer sign-off. Do not infer production sign-off from the isolated
  validation in this report.

Current evidence is limited to disposable test databases: a clean synthetic
audit returned zero duplicates/anomalies; a deliberately duplicated synthetic
credit was reported and Migration 019 correctly refused to build the index.
No historical staging or production data was accessed or audited.

## HTTPS, origins, and public Stripe sandbox webhook

- [ ] Owner supplies the staging app/API hostnames. Verify DNS points to
  staging only and the TLS certificate is valid, matches the hostname, and has
  an operational renewal path. HTTP must redirect to HTTPS.
- [ ] From outside the hosting network, verify `GET /health/live` returns
  healthy and `GET /health/ready` returns ready only when the staging database
  is available. Verify the reverse proxy preserves the raw request body for
  `/api/payments/webhook/stripe`.
- [ ] Set `CORS_ORIGINS` to the exact HTTPS customer, merchant, driver, and
  admin origins. Check preflight and API calls from each origin; an unlisted
  origin must not receive an allow-origin response. Do not use wildcard CORS.
- [ ] Configure the Stripe Dashboard in **test mode only** with the exact
  staging webhook URL ending in `/api/payments/webhook/stripe`. Subscribe only
  to the payment-intent events required by the implementation, including
  succeeded, payment-failed, and canceled. Store the endpoint's `whsec_...`
  secret only in the staging secret manager; never reuse a local Stripe CLI
  secret or print it.
- [ ] Confirm an invalid signature is rejected without changing state. For a
  valid-signature success check use the application-created test intent below:
  a generic Stripe sample may lack required UUID metadata and legitimately
  return `WEBHOOK_PAYMENT_ID_MISSING`. An ignored event returning 2xx is not
  evidence of payment reconciliation. Inspect redacted event IDs and state
  transitions without logging secrets, client secrets, or full payloads.
- [ ] Place a synthetic test-mode order using an approved Stripe test card.
  Verify it remains unpaid until the signed webhook is processed, then reaches
  the expected paid state with exactly one matching platform-clearing credit.
  Resend the same event and confirm idempotency/no duplicate credit. Exercise
  failed and canceled test intents and confirm they create no clearing credit.
- [ ] Verify dispatch/delivery remains blocked unless exactly one succeeded
  payment and one matching clearing credit exist. No refunds, Connect, payouts,
  or live keys are part of this acceptance.
- [ ] Record endpoint URL (not its secret), test event IDs, HTTP outcomes,
  redacted state evidence, and reviewer. Public delivery is not proven by a
  locally signed webhook test alone.

## Real-device GPS acceptance

Use an owner-approved staging build and a controlled test route/device. Do not
capture a person's home/work route or use real customer addresses.

- [ ] On a physical Android device and a physical iOS device if both are in
  scope, open the driver app over HTTPS and sign in with a synthetic driver.
- [ ] Grant location permission only after the user action to share location.
  Confirm a valid location update reaches the backend and the authorized
  customer tracking view reflects the latest point/time.
- [ ] Confirm updates are rate-limited to the implemented cadence (default
  minimum interval 10 seconds), stop when sharing is disabled or the app is
  unmounted/logged out, and do not continue after permission is revoked.
- [ ] Deny permission and verify a clear recoverable error with no false
  location. Re-enable permission and verify recovery. Test unavailable GPS,
  temporary network loss, and retry/reconnect without creating duplicate
  delivery transitions.
- [ ] Verify an unassigned driver, other customer, merchant, and admin cannot
  read restricted address/location data. Verify location access is not exposed
  over HTTP or to an unapproved origin.
- [ ] Record device model/OS/browser, permission choices, test route, timestamps,
  screenshots or redacted logs, observed update cadence, and sign-off.

## Five-language frontend acceptance

The supported locales are English (`en`), Spanish (`es`), Haitian Creole
(`ht`), French (`fr`), and Simplified Chinese (`zh-CN`). Language selection is
stored per browser origin; separately hosted apps do not share local storage.

- [ ] For customer, merchant, driver, and admin apps, manually select all five
  locales and verify sign-in, navigation, common actions, order/payment status,
  empty/loading/error states, and role-specific screens.
- [ ] Verify supported device-language detection, unsupported-language English
  fallback, Simplified Chinese handling, saved manual selection taking
  precedence over device language, persistence after reload, and the document
  `lang` attribute.
- [ ] Check narrow mobile and desktop layouts for clipping, overflow, unreadable
  line breaks, missing glyphs, form labels, keyboard navigation, and screen
  reader names. Check currency and status labels remain understandable.
- [ ] Repeat language preference tests independently on each app origin; do not
  assume storage is shared. Capture locale, browser/device, app role, screen,
  outcome, and evidence.

Automated localization tests cover locale labels, language detection/fallback,
manual selection, persistence, and document language. They do not replace this
four-app device/browser acceptance.

## Backup, restore, and rollback drill

- [ ] Before each staging schema/release change, use the approved database
  backup mechanism with encryption, retention, access control, and a recorded
  immutable backup ID. For PostgreSQL custom-format backups, use the provider's
  secret injection rather than putting credentials in shell history:

  ```sh
  # BACKUP_FILE must reside on an approved encrypted volume. Obtain the
  # connection URL through the secret manager, not shell history.
  pg_dump --format=custom --file="$BACKUP_FILE" "$STAGING_DATABASE_URL"
  pg_restore --list "$BACKUP_FILE" > "$BACKUP_FILE.list"
  sha256sum "$BACKUP_FILE" > "$BACKUP_FILE.sha256"
  # Restore only to a newly provisioned, isolated target database.
  pg_restore --no-owner --no-privileges --dbname="$RESTORE_DATABASE_URL" "$BACKUP_FILE"
  ```

- [ ] Restore to a new isolated database, never over the source. Verify the
  archive listing/checksum, schema migration set, row counts for approved
  non-sensitive tables, application readiness, and representative synthetic
  order/payment/ledger consistency. Record restore duration and measured RPO/
  RTO. Restrict or redact data if the source contains real personal data.
- [ ] For release rollback, stop new traffic/writes as approved, retain the
  failed deployment and its logs for investigation, restore the pre-change
  backup to a separate database, validate it, then have the named rollback
  approver authorize traffic/config switch back to the known-good application
  and database pair. Record the data-loss window and reconcile post-backup
  writes through the approved financial process.
- [ ] Do not treat a code rollback as a database rollback. Do not drop
  Migration 019's uniqueness index or edit `schema_migrations` casually; that
  weakens the duplicate-ledger invariant. Any schema rollback needs a separate
  database-owner/finance-approved change and verified restore path.
- [ ] Run the rollback drill in staging or an isolated clone, never by
  overwriting production. Record operator, timestamps, backup ID, restored
  database identity, row/checksum comparisons, readiness checks, rollback
  decision, and evidence.

An isolated PostgreSQL 16 drill on synthetic data successfully created and
verified a custom-format dump, restored it into a separate database, confirmed
user/order/payment/clearing-credit/migration counts (`1/1/1/1/13`), applied
Migration 019 to the source, and restored the pre-019 snapshot into a separate
rollback target where the index was absent and the same data counts remained.
This validates the mechanics only, not the staging provider's encryption,
permissions, retention, RPO/RTO, or production restore process.

## Skipped test and missing historical commit

The normal backend integration run reports one skipped test because
`stripe-sandbox-e2e.int.ts` is opt-in and requires `STRIPE_SANDBOX_E2E=1` plus an
`sk_test_` key. The dedicated protected GitHub Sandbox E2E workflow passed at
`fecd31d` (run linked above); it creates a real Stripe test-mode intent and
confirms it with a test card, but signs the webhook locally with a throwaway
secret. It does **not** prove Stripe can deliver to the public staging webhook
or exercise the browser Payment Element; those are manual gates above.

Commit `6d10cf3` was not present in the checkout, original preservation bundle,
remote branches/tags, or GitHub commit lookup. Do not recreate its SHA or claim
historical ancestry. The checkout-recovery behavior was implemented separately
in the review branch and covered by regression tests/CI. Runtime confidence is
supported by those tests, but exact equivalence with the unavailable commit and
any unrecorded MacBook-only changes cannot be established. If the original
checkout becomes available, compare it read-only before applying or merging
anything.

## Release readiness at `fecd31d`

**Status: staging preparation complete; staging execution and production
readiness remain blocked.** CI passed on the dedicated review branch and
`main` was not changed. The verified recovery package remains at SHA-256
`fe67abc85d00a250211be80da251f84f692ae28557ee973617482787a8241a98`.

Not completed: the protected audit of historical staging/production ledgers;
an HTTPS staging deployment and external public-webhook delivery; physical
device GPS acceptance; four-app five-language manual acceptance; provider
backup/restore/rollback and operational RPO/RTO approval. Do not deploy or
enable live payment, refund, Connect, or payout paths until all applicable
owners sign off separately.
