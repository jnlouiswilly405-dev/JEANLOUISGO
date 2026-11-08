# Frontend Recovery Inventory and Reconstruction Plan

**Status: the original frontend source is NOT recovered.** This document is a plan only. No frontend code was generated.
Search results are in `FRONTEND_SOURCE_STATUS.md`. Rebuilding requires separate owner approval.

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
