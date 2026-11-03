# Recovery v45 — API perimeter hardening

## Changes
- Production browser CORS responses are limited to exact origins listed in `CORS_ORIGINS`.
- `CORS_ORIGINS` is a comma-separated list without wildcard matching. Example:
  `CORS_ORIGINS=https://customer.example.com,https://merchant.example.com`
- Requests without an `Origin` header remain supported for health probes and server-to-server clients.
- Non-production environments retain permissive CORS for local development.
- Production API errors return a generic message; internal exception text is not returned to clients.

## Deployment notes
1. Set `NODE_ENV=production`.
2. Set `CORS_ORIGINS` to the exact HTTPS origins actually serving the web clients.
3. Do not use `*` as an origin. Do not add preview or developer origins to production.
4. Verify browser preflight and credential requirements in the real deployment before enabling any credentialed CORS behavior.
5. This change does not enable payments, payouts, or production deployment.

## Validation boundary
Static QA checks source-level security invariants only. TypeScript compilation, HTTP integration tests, browser preflight tests, and production deployment remain unverified until dependencies and a runnable environment are available.
