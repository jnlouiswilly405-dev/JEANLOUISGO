# V45 production deployment preparation

Preparation only. No production host, domain, credentials, or deployment is configured by this checklist. Obtain owner approval before deploying.

## Owner-provided deployment inputs

- [ ] Select the hosting provider and production environment.
- [ ] Provide the production API URL and the HTTPS origin for each deployed customer, merchant, driver, and admin app. Do not infer or invent domain names.
- [ ] Confirm whether the apps share an origin. Language preferences are stored per origin, so separately hosted apps do not automatically share a saved language selection.
- [ ] Name the release approver, deployment operator, monitoring/incident owner, backup/restore owner, and rollback approver.

## Hosting, HTTPS, and CORS

- [ ] Configure production DNS to point only to the owner-approved hosting endpoints.
- [ ] Terminate HTTPS with a valid certificate; redirect HTTP to HTTPS and verify renewal.
- [ ] Configure the reverse proxy to route app requests and API requests to the intended services. Keep health probes and readiness checks available to the host.
- [ ] Build each web app with `VITE_API_BASE_URL` set to the approved HTTPS API URL. Configure `VITE_STRIPE_PUBLISHABLE_KEY` only under the separate approved Stripe payment gate.
- [ ] Set backend `NODE_ENV=production`, `DATABASE_URL`, and a unique strong `JWT_SECRET` through the hosting provider's secret manager. Never commit or log secret values.
- [ ] Set `CORS_ORIGINS` to the exact HTTPS browser origins serving the four apps. Do not use `*`, localhost, or untrusted preview origins.
- [ ] Verify CORS preflight and API requests from each real app origin. Do not enable credentialed CORS unless its need and behavior are explicitly reviewed.

## Database and release

- [ ] Use PostgreSQL 16 with a persistent production database isolated from staging and development.
- [ ] Verify network access is restricted to approved services and operators; configure encrypted connections and provider-managed backups.
- [ ] Apply migrations to staging first, review the migration output, and verify a production backup and restore plan before any production migration.
- [ ] Record the exact release commit, build artifacts, migration version, deployment time, and approver.
- [ ] Deploy only after all required CI, staging, payment, operational, and owner-approval gates have passed. Verify `/health/live` and `/health/ready` after deployment.

## Pilot acceptance and operations

- [ ] Confirm the active delivery allowlist contains only NY ZIPs `10977` (Spring Valley) and `10954` (Nanuet). Verify eligible and ineligible ZIPs in both the UI and server-side order creation.
- [ ] Verify a customer can see their saved address, an assigned driver can see it, and merchant/admin/unauthorized-driver responses do not expose it.
- [ ] On a real HTTPS device, verify GPS permission, driver location updates, customer tracking, permission denial, and recovery.
- [ ] Verify English, Spanish, Haitian Creole, French, and Simplified Chinese across customer, merchant, driver, and admin apps; test device-language detection, English fallback, and saved manual selection.
- [ ] Verify monitoring, alerting, log redaction, backup restoration, incident ownership, and a tested rollback procedure.

## Explicit release blockers

- [ ] Stripe Sandbox E2E remains pending until the protected `stripe-sandbox` environment and its secret are validated through the approved workflow. Never expose or hardcode the secret.
- [ ] Production Stripe/payment behavior is not authorized by this checklist. Do not configure live keys, enable live payments, or process real transactions without separate explicit approval.
- [ ] Do not deploy or declare production readiness until every applicable gate above is verified and approved.
