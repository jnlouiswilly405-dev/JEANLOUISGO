# Frontend Recovery — Phase 0 analysis and recommendation (planning only)

No frontend code was generated. The original frontend and archive are NOT recovered; any rebuilt code would be a reconstruction.

## Evidence from the repository
- Root `package.json` is an npm workspace with a single member (`backend`); TypeScript 5.9, Node >=22.12 (CI Node 22), Vitest 5, ESM (`NodeNext`).
- Auth: custom HS256 bearer tokens (`/api/auth/login`, `/api/auth/me`), TTL from `JWT_TTL_SECONDS`; no cookies or refresh endpoint.
- CORS is allowlist-driven by `CORS_ORIGINS`; a frontend origin must be listed per environment.
- The four `apps/*/README.md` placeholders say only: "Frontend shell … Connect this app to the shared MULTIGO API under /api."
- Backend is Express 5 + PostgreSQL 16; payments are Stripe sandbox (client secret returned by `POST /api/payments`).
- The `README.md` is French; the UI language is an owner decision.

## Recommendation (for owner approval)
| Topic | Recommendation | Reason |
|---|---|---|
| Language | TypeScript (strict) | matches backend, shared types and zod contracts |
| Framework | React 19 + Vite, one SPA per role | smallest change from "frontend shell"; no SSR needed behind a bearer-token API; fast CI builds |
| Layout | add `apps/*` and `packages/api-client` to npm workspaces | one lockfile, one `npm ci`, existing CI pattern |
| API access | hand-written typed client with zod response schemas, shared by all apps | no codegen/OpenAPI exists; contract tests against the existing integration helpers |
| State | TanStack Query for server state; minimal local state | polling for tracking/notifications; no global store needed |
| Auth storage | in-memory token plus `sessionStorage` for reload; token lifetime is set by `JWT_TTL_SECONDS` | no cookie/CSRF surface; document the XSS trade-off; no refresh endpoint exists, so expiry means re-login |
| Payments UI | Stripe.js Payment Element with `pk_test_` key only, using the `clientSecret` | sandbox only; the publishable key is the only key ever in a frontend |
| Driver | responsive web app/PWA first | location updates via `POST /api/drivers/:id/location`; native app only if the owner requires it |
| Testing | Vitest + Testing Library; Playwright e2e against the CI PostgreSQL service | reuses current runners |
| Styling/design | OWNER DECISION (no original design assets available) | cannot be inferred |

## Sequence
0. Owner decisions (framework, language, brand/design, hosting, origins).
1. `packages/api-client` plus contract tests.
2. Customer app (highest value: browse, order, sandbox pay, track).
3. Merchant app.
4. Driver app.
5. Admin app (read-only financial summary, health, blocked outbox, unreferenced payments).
Each step: one commit, CI green, written approval before the next. See `FRONTEND_RECOVERY_PLAN.md` for gates.

## Backend gaps a frontend will meet (not changed here)
- No refresh-token endpoint exists (expiry means re-login). Whether `GET /api/orders` gives merchants and drivers the lists they need is unverified and must be checked in phase 1 contract tests. There is no dedicated payment-status endpoint for the customer after confirmation; poll `GET /api/orders/:id`.
- Refund, payout and settlement UI are intentionally absent.

## Open questions for the owner
Hosting/origins, languages, brand assets, driver native-app requirement, accessibility targets.
