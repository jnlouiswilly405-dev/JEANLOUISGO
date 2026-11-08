# Frontend ↔ backend dependencies and gaps

Reconstructed frontend code only. Nothing here is original recovered source.
Status after the backend dependency fixes approved on `recovery/v45-frontend-reconstruction`.

| Area | Status | What exists now | Remaining gap |
|---|---|---|---|
| Chat | **Resolved** | `POST /api/orders/:orderId/chat` (get-or-create the order thread; only the order's customer, merchant owner and assigned driver, else 404), `GET /api/chat/threads`, `GET/POST /api/chat/:threadId/messages`. Closed threads refuse messages (409). A reassigned driver is removed from the thread. UI: shared `ChatPanel` opened on demand in Customer, Merchant and Driver | No push/real-time (5 s polling), no read receipts, nothing closes threads automatically, admins cannot join |
| Notifications | **Resolved** | Created server-side, in the same transaction as the change, for order status changes (ACCEPTED…DELIVERED, CANCELLED via the actor transition), dispatch (customer ASSIGNED; driver DRIVER_ASSIGNED) and delivery (IN_TRANSIT, DELIVERED). Fixed texts only. No HTTP endpoint creates notifications. Listing and mark-read stay owner-scoped | No notification for PAID or merchant-facing events (that would touch payment code); no push/email |
| Reviews | **Resolved** | Only the order's own customer, only for a DELIVERED order; the merchant and subject user must belong to the order; admin cannot review on a customer's behalf; stable codes (`ORDER_NOT_FOUND` 404, `REVIEW_FORBIDDEN` 403, `ORDER_NOT_DELIVERED`/`REVIEW_ALREADY_EXISTS`/`REVIEW_SUBJECT_INVALID` 409) | No list endpoint (`listMerchantReviews` still unrouted) |
| Promotions | **Resolved (with an owner decision)** | `POST /api/orders` accepts `promoCode`. It is re-validated and locked inside the order transaction (usage limit and one-use-per-customer hold under concurrency), the discount is computed server-side in integer cents on the item subtotal only, and the order `total_cents` (which the payment API requires exactly) is the discounted total. Cancelling an order gives the promo use back. The order response carries a derived `discountCents` | Still no endpoint to create promos. **Owner decision:** who funds the discount (platform vs merchant) is part of the unapproved settlement policy; settlement creation stays disabled and the settlement service would see the discounted total as gross |
| Driver earnings | Unchanged | Read-only `GET /api/drivers/:driverId/earnings` | Empty while settlement is disabled; driver profile id only learnable from an assigned order |
| Merchant settlements | Unchanged | Read-only `GET /api/merchants/:merchantId/settlements` | Empty while settlement is disabled |
| Auth | Unchanged | login / `GET /api/auth/me` | No refresh token |
| Stripe | Unchanged | PaymentIntent + webhook | Sandbox E2E needs `sk_test_` / `pk_test_` keys that are not available here: test written, **NOT executed** (`docs/STRIPE_SANDBOX_E2E.md`) |

No database schema or migration was changed for any of the above. Stripe live, Connect, refunds, settlements, earnings and payouts remain disabled; the outbox worker remains disabled by default.

Numeric columns `net_amount` (legacy NUMERIC) and `net_amount_cents` (BIGINT) both arrive as strings from pg. Promo amounts in the database and in `/api/promos/validate` are NUMERIC major units; the order flow converts to cents on the server.
