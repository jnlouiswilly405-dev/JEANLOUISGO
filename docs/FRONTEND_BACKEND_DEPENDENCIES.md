# Frontend ↔ backend dependencies and gaps

Reconstructed frontend code only. Nothing here is original recovered source.
No backend code was changed to produce this list.

| Area | Existing API | Gap | Frontend status |
|---|---|---|---|
| Chat | `GET/POST /api/chat/:threadId/messages` | Nothing creates threads; no endpoint lists threads or finds an order's `threadId` | **Blocked** — no UI. Client methods and a contract test exist |
| Notifications | `GET /api/notifications`, `POST /api/notifications/:id/read` | Nothing in the backend creates notifications, so lists are empty in practice | Panel built (Customer, Merchant, Driver) |
| Reviews | `POST /api/reviews` (CUSTOMER/ADMIN) | No list endpoint. **Security gap:** `createReview` does not check order ownership or DELIVERED status. Duplicates return 409 with a raw constraint message | Form built; not fixed in backend |
| Promotions | `POST /api/promos/validate` | Order creation accepts no promo code, so no redemption; no promo-creation endpoint; amounts are NUMERIC major units (assumed, unverified) | Preview only, labelled as such |
| Driver earnings | `GET /api/drivers/:driverId/earnings` | Returns only `ELIGIBLE` rows; settlement creation is disabled so empty. Driver profile id is only learnable from an assigned order | Read-only view |
| Merchant settlements | `GET /api/merchants/:merchantId/settlements` | Same: empty while settlement is disabled | Read-only view |
| Auth | login / `GET /api/auth/me` | No refresh token | Session lost on token expiry |
| Stripe | PaymentIntent + webhook | Sandbox E2E needs `sk_test_` / `pk_test_` keys, which are not available here | Test written, **NOT executed** (`docs/STRIPE_SANDBOX_E2E.md`) |

Numeric columns `net_amount` (legacy NUMERIC) and `net_amount_cents` (BIGINT) both arrive as strings from pg.

Owner decisions pending: settlement policy, UI language and design, backend fixes above.
