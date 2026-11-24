# V45 DigitalOcean Ubuntu staging preparation

Preparation only: no DigitalOcean resources, DNS, credentials, webhooks, or
deployments have been created or changed. This is a proposed single-Droplet
Ubuntu LTS, Nginx, Node, and managed PostgreSQL topology, not an instruction
to provision it. The owner must approve the architecture, cost and deployment
first. Keep production, live payments, refunds, Connect, and payouts disabled.

## Required decisions and authorizations

| Action or access | Required authorization and input |
| --- | --- |
| DigitalOcean account/project, Droplet, managed database, storage, backups, restore clones | Owner selects project, region, supported Ubuntu LTS/Node versions, sizing, retention, cost ceiling and billing approval. Restore clusters and Droplets may incur charges. |
| Domain, DNS and TLS | Domain owner approves five staging hostnames and DNS changes: API plus customer, merchant, driver and admin. Owner authorizes certificates and renewals. |
| Host and secret access | Owner grants named operators restricted SSH, secret-manager and deployment access; selects an approved secret-delivery mechanism. Never paste credentials into issues, chat, source, build artifacts, or logs. |
| Database access or historical snapshot | Database/data owner authorizes named read-only operator, exact source/snapshot and scope. Financial findings require finance-owner review. Production data is not authorized by this plan. |
| Migration 019 | Database and finance owners review the protected audit and approve a separate backup, maintenance window and migration. No remediation by deleting or altering ledger history. |
| Staging deployment, Stripe test endpoint and synthetic test orders | Owner approves the exact commit, staging change window, test-mode Stripe account/endpoint access, and designated operator. No live credentials or real payments. |
| Physical GPS tests | Device owner/tester consents to an approved synthetic route and location collection; restrict retention and access to evidence. |
| Backup/restore, rollback, network and traffic changes | Database and infrastructure owners approve target, costs, data-loss window, access and rollback switch; restore to isolated targets first. |

No action above is implied by approval of this preparation document. Record
the approver, change ticket, time window and exact target before each action.

## Proposed monthly budget, USD before tax

Price research: 2026-11-24. The following is an **exact arithmetic proposal
for these assumptions**, not an account-specific quote or final bill. Confirm
the selected region, plan, billing screen and pricing before authorizing any
resource.

| Item | Proposed configuration | Monthly |
| --- | --- | ---: |
| Bundled Basic Droplet | `s-2vcpu-2gb`: 2 shared vCPU, 2 GiB RAM, 60 GiB disk, continuously running | $18.00 |
| Droplet backup | Basic weekly plan, 20% of $18.00 | $3.60 |
| Managed PostgreSQL Standard | 1 GiB, single node, entry-level plan, no extra storage or standby | $15.00 |
| Cloud Firewall, DigitalOcean DNS and monitoring | Basic services; use an already-owned domain | $0.00 |
| TLS certificate | Let's Encrypt, assuming approved domain control and ACME | $0.00 |
| **Proposed base total** | **$18.00 + $3.60 + $15.00** | **$36.60** |

This assumes no snapshots, extra storage, second Droplet/database, paid logging
or secret manager, support plan, paid DNS/domain renewal, load balancer,
billable transfer overage or tax. Any of these, and temporary restore/fork
resources, can add charges. One-node PostgreSQL and one Droplet are not highly
available; this is a small staging proposal, not production capacity or a
performance guarantee. The managed database offers daily point-in-time backups
within its documented seven-day window; confirm the selected edition and
account's included backup terms. Weekly Droplet backups are not database
backups. Build on a suitably provisioned CI runner if the 2 GiB host cannot
build the apps; transfer only an approved immutable artifact.

The cited PostgreSQL pricing page starts a Standard single-node 1 GiB cluster
at $15.00, while another current managed-database pricing table shows a $15.15
1 GiB row for a differently described plan. **Do not assume which price or
plan is offered to this account.** If the approved PostgreSQL SKU is instead
$15.15, the same base arithmetic becomes **$36.75/month**; other differences
need a new quote. Availability, tax, charges for provider restore drills and
final billed amounts must be confirmed in the owner's DigitalOcean console.
The owner must choose and approve a spending cap, including a separate
temporary-drill allowance; no paid resources are authorized by this proposal.

Sources: [Droplet price](https://www.digitalocean.com/pricing/droplets),
[bundled Droplet billing](https://docs.digitalocean.com/products/droplets/details/pricing/),
[backup pricing](https://docs.digitalocean.com/products/backups/details/pricing/),
[PostgreSQL pricing](https://docs.digitalocean.com/products/databases/postgresql/details/pricing/),
[managed database table](https://www.digitalocean.com/pricing/managed-databases),
[PostgreSQL backup features](https://docs.digitalocean.com/products/databases/postgresql/details/features/),
[DNS pricing](https://docs.digitalocean.com/products/networking/dns/details/pricing/),
[monitoring pricing](https://docs.digitalocean.com/products/monitoring/details/pricing/),
[Droplet bandwidth billing](https://docs.digitalocean.com/platform/billing/bandwidth/),
and [Let's Encrypt](https://letsencrypt.org/).

## Proposed host and network configuration

1. After approval, create an isolated staging project/VPC and host using
   SSH keys, a non-root service account, security updates, least-privilege
   operators, and monitoring. Do not copy production data or secrets to it.
   Record the approved image/version, instance ID and asset owner.
2. Attach a DigitalOcean Cloud Firewall and host firewall: permit TCP 22 only
   from approved operator addresses or VPN, and TCP 80/443 as required for
   public HTTPS/certificate issuance. Permit only required outbound DNS,
   updates, HTTPS to Stripe, and the database connection. Configure both IPv4
   and IPv6 deliberately. Restrict admin UI access to approved operators.
   Test the firewall externally from allowed and denied networks.
3. **Never expose TCP 4000 or PostgreSQL to the Internet.** The current
   Express service calls `app.listen(port)` and listens on all interfaces;
   setting an Nginx upstream to `127.0.0.1:4000` alone does not make the Node
   listener loopback-only. Deny direct access at the cloud and host firewalls,
   including private/VPC interfaces except explicitly authorized access.
4. Put the API and each Vite application on its own approved HTTPS hostname
   at `/`; the apps use root-relative Vite assets and subpath deployment has
   not been validated. Nginx terminates TLS and proxies API requests to
   `http://127.0.0.1:4000`, including
   `/api/payments/webhook/stripe`, without altering signed request bytes.
   Serve each app's own `apps/<role>/dist` with SPA fallback to `index.html`.
   Do not proxy the webhook to an authentication page or log request bodies.
5. Once DNS is approved and resolves, issue a valid hostname-matching
   certificate using the organization's ACME/certificate process. Verify HTTP
   redirects to HTTPS, trust/hostname/expiry, renewal, and external access to
   `/health/live` and `/health/ready`. Readiness checks database connectivity,
   not payment or business readiness.

Illustrative Nginx locations **inside an owner-configured TLS server**, not a
complete certificate or deploy configuration (replace the app path):

```nginx
# API hostname
location / {
    proxy_pass http://127.0.0.1:4000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
}

# Separate app hostname; do not combine this location with the API location.
# root /srv/jeanlouisgo/current/apps/customer/dist;
# location / { try_files $uri $uri/ /index.html; }
```

Confirm Nginx config syntax and apply only through the approved staging change.
The host must also retain the existing webhook's raw-body behavior and request
size limit. Nginx, operating system, Node, and certificates need named patch
and renewal owners.

## Builds, runtime, and secrets

- Pin the approved review commit and Node version compatible with the
  repository (`>=22.12`). Use `npm ci`, then `npm run build`. The backend
  output is `backend/dist/server.js`; each of the four app builds writes its
  own `apps/<role>/dist`. Serve immutable, versioned artifacts and retain the
  previous known-good artifact for rollback.
- Set public build-time `VITE_API_BASE_URL` to the approved HTTPS API origin
  for all four apps; set `VITE_STRIPE_PUBLISHABLE_KEY` to a `pk_test_...` key
  for the customer app only if sandbox checkout is authorized. `VITE_*`
  values are embedded in browser assets: never put a secret in them.
- Inject backend `NODE_ENV=production`, `PORT=4000`, a unique strong
  `JWT_SECRET` (at least 32 characters), the staging `DATABASE_URL`, and exact
  comma-separated HTTPS browser origins in `CORS_ORIGINS`. The production-mode
  checks enforce a non-default JWT secret and require a database; do not use
  `.env.example` credentials. Set `OUTBOX_WORKER_ENABLED` unset or `false`;
  enabling it needs separate review.
- Only for an authorized test-mode Stripe staging run, provide
  `STRIPE_SECRET_KEY` (`sk_test_...` only) and the **public endpoint's**
  `STRIPE_WEBHOOK_SECRET` from the protected secret store. The provider remains
  disabled if either is missing; live and restricted-live keys are rejected.
  Keep `STRIPE_SANDBOX_E2E` for the protected test workflow, not service config.
  Mask and rotate exposed keys, and restrict account permissions.
- Run the backend under an unprivileged service account with restart policy,
  restricted filesystem access and protected runtime secret delivery. A
  systemd `EnvironmentFile` owned by root with restrictive permissions is a
  possible delivery mechanism only if the owner accepts its exposure model;
  ordinary environment variables can be visible to privileged processes and
  must not be printed by diagnostics. The working directory must be `backend`
  and startup command equivalent to `npm run start --workspace backend` from
  the repository root or `node dist/server.js` from `backend`.
- Do not assume a firewall alone protects admin functions: verify application
  authentication and role checks, synthetic test identities, and admin
  network restrictions. Preserve log redaction; never log webhook payloads,
  location traces, passwords, database URLs, or Stripe client secrets.
- The payment service stores verified webhook payloads in
  `payment_events.payload`. Treat the staging database, exports and backups as
  sensitive even when proxy/application request-body logging is disabled.

Example systemd unit for review only. The operator must first create the
unprivileged `jeanlouisgo` user, provision the root-owned protected environment
file, verify the Node path and make the immutable release readable by that
user. Do not copy this to a host or start it without deployment approval.

```ini
[Unit]
Description=JEANLOUISGO staging API
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=jeanlouisgo
Group=jeanlouisgo
WorkingDirectory=/srv/jeanlouisgo/current/backend
EnvironmentFile=/etc/jeanlouisgo/staging.env
ExecStart=/usr/bin/node dist/server.js
Restart=on-failure
RestartSec=5
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true

[Install]
WantedBy=multi-user.target
```

The proposed unit still needs staging verification for package resolution,
secret delivery, logs, database connectivity and firewall isolation. It does
not itself constrain the API listener to loopback.

## Managed PostgreSQL and migration gate

Use a staging-only cluster and database, dedicated least-privilege application
role, separate migration role, and a distinct read-only audit role. Restrict
DigitalOcean trusted sources and network access to the staging service and
approved operators; do not grant the service an administrative database role.

Require encrypted connections **with certificate and hostname verification**.
DigitalOcean's default `sslmode=require` encrypts but does not authenticate the
server. Use its edition-specific CA and verified hostname guidance. The
backend uses Node `pg` with `DATABASE_URL`; test certificate validation with
that exact driver/runtime and fail closed for an untrusted CA or wrong
hostname. `psql`/`pg_dump` use libpq and may need different CA settings; a
successful `psql` test alone does not prove Node's TLS settings. Never disable
TLS verification as a workaround. Keep connection strings and passwords out of
process arguments, shell history and evidence.

For a new empty isolated staging database, confirm owner approval and follow
the repository's base schema plus ordered migration instructions. For an
existing database, identify its actual schema and `schema_migrations` history
first; never replay `database/schema.sql` over it. `database/migrate.sh`
applies every pending migration **including 019** and is not a safe command
to run when 019 must be deferred. The workflow deferral input applies only to
those CI workflows; it does not change the migration script.

Before migration 019 on any historical database, follow
[`HISTORICAL_LEDGER_AUDIT_019.md`](HISTORICAL_LEDGER_AUDIT_019.md) using an
approved read-only snapshot, verify a backup and obtain finance/database-owner
sign-off. Confirm schema compatibility with the chosen binary and record
schema version, index predicate, and redacted duplicate count. A synthetic
audit is not evidence that historical data is clean.

## Public sandbox and device acceptance

Use the detailed matrix and expected outcomes in
[`V45_FINAL_STAGING_READINESS.md`](V45_FINAL_STAGING_READINESS.md). After
separate staging, test-account and endpoint approval:

- Register the exact public HTTPS endpoint
  `/api/payments/webhook/stripe` in Stripe **test mode**, with only
  `payment_intent.succeeded`, `payment_intent.payment_failed`, and
  `payment_intent.canceled` as needed. Keep its signing secret in the secret
  store. Verify invalid/missing signatures are rejected without state change.
- Create an actual synthetic order through this backend, confirm its Stripe
  test-mode PaymentIntent, and verify Stripe's public delivery succeeded, the
  order transitions only after the signed event, and exactly one matching
  clearing credit exists after replay. Check failure/cancellation, recovery
  across devices/closed sessions and payment/delivery guards. Record redacted
  event IDs and HTTP outcomes. Do not resend a sensitive body in chat.
- A generic Dashboard/CLI sample `payment_intent` may not have this
  application's UUID `paymentId` and `orderId` metadata; the handler correctly
  rejects such events with `WEBHOOK_PAYMENT_ID_MISSING`. A 2xx for an unrelated
  ignored event or a local signature test does not prove payment
  reconciliation. Use an application-created test intent for the acceptance
  gate and investigate rejected events instead of bypassing validation.
- On approved physical devices and synthetic routes, check GPS permission
  grant/denial/recovery, sharing stop, minimum 10-second update interval,
  tracking visibility and network loss. Across customer, merchant, driver and
  admin apps, test English, Spanish, Haitian Creole, French and Simplified
  Chinese, including language detection/fallback, per-origin persistence,
  layout and accessible labels. Record device/browser, role, locale, scenario,
  result and reviewer; protect location evidence.

## DigitalOcean backup, restore, and rollback acceptance

After cost and access approval, record the provider's actual retention,
encryption, backup completion status, recovery-point objective and recovery
time objective for the selected services. Managed PostgreSQL supports
point-in-time restore to a new cluster; check its current retention and edition
limits before choosing a recovery point. A Droplet disk backup is not a
substitute for a consistent managed-database backup, nor does a PostgreSQL
backup preserve app releases, secrets, DNS, firewall or certificate state.

Fork a known backup to a **new isolated** staging database/cluster, not an
in-place restore of the source; confirm that the selected provider operation
really creates a separate cluster and obtain approval for its temporary cost.
Verify
backup identity, schema, redacted counts and representative synthetic payment
and ledger invariants, correct CA/trusted sources, and service readiness
without exposing the restored data. Restore a Droplet backup to an isolated
test Droplet if approved; confirm access controls, release, services and
configuration without starting live integrations. Capture start/finish times,
measured RPO/RTO, operator, target identifiers and sign-off; avoid recording
credentials. Never overwrite the original host/database during the drill.

For a real rollback, have the named approver pause writes and assess lost
writes and provider events since the restore point. Validate the matching
known-good application artifact and restored database separately before any
approved traffic/configuration switch. Reconcile test events as necessary and
verify uniqueness, health and webhook behavior. Restoring a pre-019 database
removes its uniqueness index; do not expose it to writes until the database and
finance owners approve a safe path. Preserve the old system and evidence until
retention/cleanup is authorized. Provider drills remain **not executed**.

## Evidence and remaining blockers

- Review candidate `fecd31d278866f3da4fbf4de8d42de47ce13d16a`:
  [PostgreSQL CI](https://github.com/jnlouiswilly405-dev/JEANLOUISGO/actions/runs/45431341372)
  and [Stripe Sandbox E2E](https://github.com/jnlouiswilly405-dev/JEANLOUISGO/actions/runs/45431391224)
  passed with 019 deferred in CI. The Sandbox E2E signs a local webhook; it
  does not verify public Stripe delivery. Re-run/check CI for the final
  approved SHA.
- Migration 019 and synthetic backup/restore mechanics were checked in
  disposable PostgreSQL 16 as described in the linked acceptance plan. On
  2026-11-24, the documented audit queries also ran as a read-only role against
  an isolated synthetic PostgreSQL 16 dataset: a duplicate and unlinked credit
  were detected, and the read-only transaction rejected an attempted insert.
  No provider account, staging database, host, real device or historical
  ledger has been accessed for this preparation.
- The preserved recovery package SHA-256 is
  `fe67abc85d00a250211be80da251f84f692ae28557ee973617482787a8241a98`.
  Its included branch bundle ends at `a6e07bb`, not at this later documentation
  commit; fetch later commits separately. Do not replace the original package.
- Blockers: owner-approved budget/architecture and protected access, an
  authorized deployment and historical audit, verified TLS/database identity,
  public Stripe test delivery, device/locale acceptance, provider backup and
  rollback drill, named operational owners and sign-offs.

Provider references (confirm current plan/edition behavior before approval):
[DigitalOcean PostgreSQL security](https://docs.digitalocean.com/products/databases/postgresql/how-to/secure/),
[PostgreSQL restore](https://docs.digitalocean.com/products/databases/postgresql/how-to/restore-from-backups/),
[PostgreSQL fork](https://docs.digitalocean.com/products/databases/postgresql/how-to/fork-clusters/),
[Cloud Firewall rules](https://docs.digitalocean.com/products/networking/firewalls/how-to/configure-rules/),
[Droplet backup restore](https://docs.digitalocean.com/products/backups/how-to/create-and-restore/).

## Final staging execution checklist

The owner's approval of technical review is **not** approval to provision,
incur charges, access protected data, deploy or change DNS/Stripe settings.
Each item stays unchecked until its evidence is recorded.

- [ ] **Owner:** choose region and account/project, confirm the console's
  Droplet/database/backup prices and retention, approve budget plus a cap for
  temporary restore resources, and choose named operator and reviewers.
- [ ] **Owner/domain administrator:** approve five actual hostnames and DNS/
  certificate changes. **Owner:** approve the exact staging commit, date,
  isolated synthetic data, SSH/VPN sources, service and secret access.
- [ ] **Database/data owner and finance reviewer:** authorize any protected
  historical snapshot and read-only access. Review the
  [audit procedure](HISTORICAL_LEDGER_AUDIT_019.md), findings and consistent
  cutover plan. Separately approve backup and Migration 019 after sign-off;
  neither is authorized by technical review.
- [ ] **Approved operator:** only after resource authorization, verify firewall
  isolation, no public API port 4000, database trusted sources and certificate
  identity, service secrets, exact app origins, TLS renewal and health. Capture
  redacted network/TLS/configuration evidence and candidate SHA.
- [ ] **Stripe account owner/operator:** separately approve and configure the
  test-mode endpoint and keys. Run application-created test-intent success,
  failure, cancellation, duplicate-delivery and signature-rejection checks;
  record redacted event IDs, HTTP outcomes and reconciled ledger counts.
- [ ] **Device owners/testers:** consent to controlled GPS checks on the
  approved physical devices; record permission, stop/recovery and access-control
  outcomes without exposing route history. Test the five locales on all four
  apps using the linked acceptance matrix, with reviewer and evidence for each.
- [ ] **Backup and database owners:** approve and fund isolated provider
  database fork and Droplet restore drills. Check point-in-time, integrity,
  restored schema/data invariants, isolation and actual RPO/RTO; document
  rollback/traffic-switch approval and reconcile events after the backup point.
- [ ] **Release owner:** collect CI links for the final candidate, audit and
  test evidence, incident contacts, remaining risks and written approvals.
  Staging acceptance is not permission to merge to `main`, deploy production,
  or enable live payments, refunds, Connect or payouts.
