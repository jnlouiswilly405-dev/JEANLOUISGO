# Frontend Recovery Inventory and Reconstruction Plan

**Status: the original frontend source is NOT recovered.** Sections 1–5 are the original plan (written before approval).
A reconstruction was subsequently approved and built; its actual status is in section 6.
Search results are in `FRONTEND_SOURCE_STATUS.md`.

## 1. Inventory (what exists)

| App | Path | Present | Missing |
|---|---|---|---|
| Customer | `apps/customer/` | `README.md` only | everything else |
| Driver | `apps/driver/` | `README.md` only | everything else |
| Merchant | `apps/merchant/` | `README.md` only | everything else |
| Admin | `apps/admin/` | `README.md` only | everything else |

The exact original file list, framework and design are unknown. Only the backend API contract below is known.

## 2. Backend API contract available to a frontend (from `backend/src`)

| Area | Endpoint | Roles |
|---|---|---|
| Auth | `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me` | public / any |
| Merchants | `GET /api/merchants`, `POST /api/merchants` | public / MERCHANT, ADMIN |
| Catalog | `GET /api/catalog/merchant/:merchantId`, `POST /api/catalog` | public / MERCHANT, ADMIN |
| Orders | `GET /api/orders`, `GET /api/orders/:id`, `POST /api/orders`, `POST /api/orders/:id/status` | any / any / CUSTOMER, ADMIN / ADMIN, MERCHANT, DRIVER |
| Payments | `POST /api/payments` (CUSTOMER, ADMIN); Stripe webhook is server-to-server only | |
| Tracking | `GET /api/orders/:orderId/tracking`, `POST /api/drivers/:driverId/location`, `POST /api/orders/:orderId/delivery` | any / DRIVER, ADMIN |
| Chat | `GET/POST /api/chat/:threadId/messages` | any authenticated |
| Notifications | `GET /api/notifications`, `POST /api/notifications/:id/read` | any authenticated |
| Reviews / promos | `POST /api/reviews` (CUSTOMER, ADMIN), `POST /api/promos/validate` | |
| Earnings / settlements | `GET /api/drivers/:driverId/earnings`, `GET /api/merchants/:merchantId/settlements` | DRIVER, MERCHANT (read only; financial flows disabled) |
| Admin | `GET /api/admin/financial-summary`, `/api/admin/health`, `/api/admin/outbox/blocked` | ADMIN |

Not exposed to any UI: refunds (`POST /api/payments/:paymentId/refund` is stubbed), payouts, settlement creation.

## 3. Minimal reconstruction plan (requires approval)

Principle: thin clients against the existing `/api`; no backend change; no financial UI beyond read-only views.

1. **Decision gate (owner):** supply the original archive, or approve a rebuild; choose framework (suggest one shared TypeScript/Vite workspace).
2. **Shared package:** typed API client (auth token handling, error mapping 403/409), generated from the routes above.
3. **Customer MVP:** register/login, merchant list, catalog, create order, pay (Stripe sandbox Elements using the returned `clientSecret`, test mode only), order tracking, notifications.
4. **Merchant MVP:** login, merchant profile, catalog management, order status updates, read-only settlements view.
5. **Driver MVP:** login, location updates, delivery progression, read-only earnings view.
6. **Admin MVP:** login, financial summary, health, blocked outbox events (read-only).
7. **Gates:** add each app to the npm workspaces and CI (build, lint, unit tests) one app per commit; e2e against the PostgreSQL CI service.
8. **Safety:** no payout, refund or settlement-triggering UI; no Stripe live keys; only the publishable test key is ever placed in a frontend.

## 4. Remaining blockers
- Original frontend archive unavailable; byte-exact archive verification stays INCOMPLETE.
- Owner approval for a rebuild, and the framework and design decisions.

## 5. Controlled reconstruction: phases, gates and acceptance (still a plan; nothing generated)
Rules for every phase: new files only under `apps/<role>/` and a shared package; no changes to `backend/`; existing README placeholders preserved; nothing is described as "recovered" or "original" — rebuilt code must be labelled a reconstruction; one reviewable commit per app; each phase needs written approval.

| Phase | Deliverable | Acceptance gate |
|---|---|---|
| 0 | Owner decisions: framework, hosting, design/brand assets, supported languages (approved: `en`, `es`, `ht`, `fr`, `zh-CN`) | decision record in `docs/` |
| 1 | `packages/api-client`: typed client for the section 2 endpoints, error mapping (401/403/409/503), no secrets | type-check; contract tests against the PostgreSQL CI service using the existing integration helpers |
| 2 | Customer app: auth, merchants/catalog, order creation, sandbox payment (publishable `pk_test_` key only), tracking | build and lint in CI; e2e happy path against the test API; Stripe test-mode only |
| 3 | Merchant app: catalog and order status, read-only settlements | role-guard tests (a merchant cannot reach admin or driver data) |
| 4 | Driver app: location and delivery progression, read-only earnings | same |
| 5 | Admin app: financial summary, health, blocked outbox, unreferenced payments (read-only) | ADMIN-only enforced server-side (already covered by integration tests) |

Safety: no UI calls refund, payout or settlement-creation; there are none to call. Frontends never hold secret keys. If the original archive appears, it replaces this plan and is diffed against any reconstruction.

## 6. Reconstruction status (branch `recovery/v45-frontend-reconstruction`; RECONSTRUCTED, not recovered)

Stack (owner-approved): React 19, Vite, TypeScript, Vitest + Testing Library; separate apps sharing `packages/api-client` (zod-validated typed client) and `packages/app-shell` (session, role gate, login). No backend endpoint was invented and no schema changed; `backend/integration/api-client-contract.int.ts` runs the real client against the real backend on PostgreSQL 16.

| Module | Scope built | Not built |
|---|---|---|
| `packages/api-client` | auth, merchants, catalog, orders, payments (create), tracking, driver location/delivery, notifications, admin reads | refunds, settlements, earnings, payouts (deliberately absent; a unit test asserts this) |
| `packages/app-shell` | in-memory token mirrored to sessionStorage, cleared on logout/401, wrong-role rejection | refresh tokens (backend has none) |
| Customer | browse, cart, order, list, detail with polling and driver location, Stripe Payment Element (sandbox), order chat, notifications, reviews on DELIVERED orders, promo code applied by the server at order creation | nothing outstanding beyond polling-only chat; merchant review list shown on the menu |
| Merchant | order list with only the valid next status, menu/restaurant management for owned restaurants, read-only settlements, notifications, order chat, customer reviews (read-only) | write actions on settlements (none exist) |
| Driver | active/history, delivery progression, opt-in throttled location sharing, read-only earnings, notifications, order chat | the driver learns its profile id only from an assigned order (no profile endpoint) |
| Admin | health, financial summary (read-only), blocked outbox (paginated, filtered), unreferenced payments, promotions (create/list/deactivate) | the only write action is promotion create/deactivate (platform-funded by default); no settlement, payout or refund action exists |

Payment safety: `PaymentStep` accepts only `VITE_STRIPE_PUBLISHABLE_KEY` values starting with `pk_test_` and renders no form otherwise. It never sets an order to PAID; PAID comes only from the backend's verified webhook, and the UI just waits and re-reads the order. Stripe.js is loaded from Stripe at runtime. Built bundles were scanned and contain no `sk_`, `whsec_` or `pk_live` strings.

Backend gaps for chat, notifications, reviews and promos were fixed (see `FRONTEND_BACKEND_DEPENDENCIES.md` for what each now does and what remains). Stripe sandbox E2E (`STRIPE_SANDBOX_E2E.md`) is written but NOT executed.

Remaining blockers: Stripe sandbox E2E not executed (no test credentials); original frontend and ZIP not recovered (all frontend code is a reconstruction); byte-exact archive verification INCOMPLETE; chat is polling only; no PAID notification; no refresh token; settlement policy and merchant-funded promos are owner decisions.

UI localization is being implemented on branch `copilot/v45-multilingual-ui` for the five approved languages. The remaining decisions are visual design, hosting and CORS origins, and whether to add the unbuilt read-only views. Browser language preference is stored per origin, so separately hosted frontends do not automatically share it. Byte-exact archive verification remains INCOMPLETE.
