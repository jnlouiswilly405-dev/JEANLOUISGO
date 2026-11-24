# Staging Readiness Checklist

This checklist is for a staging environment only. Do not use production credentials, real customer data, or real payment credentials.

For the detailed V45 execution procedures, acceptance evidence, migration 019
gate, public Stripe webhook checks, GPS/language matrix, and backup/restore/
rollback drill, see [V45 final staging readiness](docs/V45_FINAL_STAGING_READINESS.md).

## Environment isolation and security

- [ ] Use a dedicated staging domain and confirm its DNS points to the staging host.
- [ ] Configure the reverse proxy for the staging service, redirect HTTP to HTTPS, and verify certificate renewal.
- [ ] Use a separate staging database and persistent data volume; confirm staging cannot access production data or services.
- [ ] Use synthetic test accounts and data only.
- [ ] Store `ADMIN_API_TOKEN` and delivery-signing keys in the hosting platform's secret manager. Generate staging-only values, restrict access, and ensure values are not logged or committed.
- [ ] Configure the protected GitHub environment `stripe-sandbox` with the test-only `STRIPE_TEST_SECRET_KEY`; never print or commit its value. Verify the workflow refuses keys that are not Stripe test-mode keys.

## Staging verification

- [ ] Deploy the intended release candidate and confirm service health and database migrations.
- [ ] Complete customer checkout and verify the order is recorded with the expected total and state.
- [ ] Dispatch a courier and verify order lifecycle transitions and customer-visible tracking.
- [ ] Verify GPS permission, location updates, and tracking over HTTPS on a real phone; test denied permission and recovery.
- [ ] Run the approved Stripe Sandbox E2E workflow and verify test-mode payment success, failure/cancellation, duplicate callback handling, and payment/order reconciliation. Do not enable live payments.
- [ ] Create a staging backup, restore from backup into an isolated target, and verify restored data and service operation.
- [ ] Confirm logs, alerts, and monitoring work without exposing secrets or sensitive customer data.

## Operations and release gate

- [ ] Name the person responsible for backup and restore.
- [ ] Name the person responsible for monitoring and incident response.
- [ ] Document and test the rollback procedure; name the person authorized to execute it.
- [ ] Record test evidence, build/version, date, and owners for each completed staging check.
- [ ] Do not declare production readiness until every staging check passes, payment reconciliation is verified, and backup, monitoring, and rollback owners are assigned.

## Checks verified outside staging

The review branch at `51b8d54` passed PostgreSQL CI and the protected Stripe
Sandbox E2E workflow. Migration 019 and synthetic backup/restore/rollback
mechanics were also validated in isolated PostgreSQL 16 databases. These checks
do not certify an actual staging deployment, historical-ledger audit,
public-webhook delivery, physical-device GPS, or provider-managed backup/
restore/rollback.

Do not mark staging checks complete based only on local tests or these isolated
drills. Record staging-specific evidence and owners against every applicable
gate in the detailed plan before declaring release readiness.
