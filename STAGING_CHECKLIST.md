# Staging Readiness Checklist

This checklist is for a staging environment only. Do not use production credentials, real customer data, or real payment credentials.

## Environment isolation and security

- [ ] Use a dedicated staging domain and confirm its DNS points to the staging host.
- [ ] Configure the reverse proxy for the staging service, redirect HTTP to HTTPS, and verify certificate renewal.
- [ ] Use a separate staging database and persistent data volume; confirm staging cannot access production data or services.
- [ ] Use synthetic test accounts and data only.
- [ ] Store `ADMIN_API_TOKEN` and delivery-signing keys in the hosting platform's secret manager. Generate staging-only values, restrict access, and ensure values are not logged or committed.
- [ ] Configure MonCash sandbox credentials only. Verify no production MonCash credentials or endpoints are configured.

## Staging verification

- [ ] Deploy the intended release candidate and confirm service health and database migrations.
- [ ] Complete customer checkout and verify the order is recorded with the expected total and state.
- [ ] Dispatch a courier and verify order lifecycle transitions and customer-visible tracking.
- [ ] Verify GPS permission, location updates, and tracking over HTTPS on a real phone; test denied permission and recovery.
- [ ] Exercise MonCash sandbox payment success, failure/cancellation, and duplicate callback handling; verify payment/order reconciliation.
- [ ] Create a staging backup, restore from backup into an isolated target, and verify restored data and service operation.
- [ ] Confirm logs, alerts, and monitoring work without exposing secrets or sensitive customer data.

## Operations and release gate

- [ ] Name the person responsible for backup and restore.
- [ ] Name the person responsible for monitoring and incident response.
- [ ] Document and test the rollback procedure; name the person authorized to execute it.
- [ ] Record test evidence, build/version, date, and owners for each completed staging check.
- [ ] Do not declare production readiness until every staging check passes, payment reconciliation is verified, and backup, monitoring, and rollback owners are assigned.

## Checks reported as already completed locally

The project owner reported local tests, a container build, checkout/courier dispatch, and backup/restore as passing. These reports are not a substitute for running and recording the relevant checks against the isolated staging environment above.
