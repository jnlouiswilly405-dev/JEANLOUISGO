# Stripe Implementation Plan (sandbox phases implemented; live NOT approved)

Status: **test-mode sandbox implemented** for phases 1–4 and 6 (see "Implementation status"). Phases 5 (application refunds) and 7 (Connect payouts) are NOT implemented and remain disabled. Live payments are not approved. Settlement policy (`SETTLEMENT_FINANCIAL_POLICY_GATE.md`, `SETTLEMENT_POLICY_PROPOSAL.md`) is a separate, still-undecided gate and no step below may invent fees, commissions, tax, tip or driver-pay rules.

## Implementation status
- Done (sandbox, test keys only): `stripe` SDK dependency; `backend/src/modules/payments/stripe-provider.ts` (PaymentIntent creation with forwarded idempotency key, always `PENDING`; test-key-only guard that rejects `sk_live_`/`rk_live_`); raw-body signature-verified webhook `POST /api/payments/webhook/stripe` (`express.raw` mounted before `express.json`, payment fields taken from the verified event only); existing amount/currency/reference reconciliation and `(provider,event_id)` replay protection; unit tests (fake client, real signature helpers) and PostgreSQL integration tests.
- Disabled by default: Stripe stays off unless `STRIPE_SECRET_KEY` (`sk_test_...` or `rk_test_...`) and `STRIPE_WEBHOOK_SECRET` are both set. No Stripe keys are in CI.
- Provider-level `createRefund` exists and is unit tested with a fake client, but the application refund path (`refundPayment`, `POST /api/payments/:id/refund`) still throws `REFUND_PROVIDER_NOT_IMPLEMENTED`; ledger and settlement reversal need the approved policy.
- Not done: scheduled reconciliation job against Stripe, real sandbox end-to-end run with a Stripe test account and Stripe CLI, Connect, payouts, any live key.
- Known caveat: the PaymentIntent is created inside the payment DB transaction (row locks held during the network call); acceptable for sandbox, to be revisited before live use.

## Original stub points (before this work)

- `backend/src/modules/payments/provider.ts`: `getProvider('stripe')` throws `PAYMENT_PROVIDER_NOT_IMPLEMENTED`; `MockPaymentProvider` is allowed only when `NODE_ENV` is `test` or `development`.
- `backend/src/modules/payments/payment.routes.ts`: `POST /api/payments/webhook/:provider` reads `rawBody` and `signature` from the parsed JSON body, which cannot verify a Stripe signature.
- `backend/src/modules/payments/payment.service.ts`: `refundPayment` always throws `REFUND_PROVIDER_NOT_IMPLEMENTED`.
- `backend/src/modules/settlements/service.ts`: `markDriverEarningsPaid` / `markMerchantSettlementsPaid` always throw `PAYOUT_PROVIDER_CONFIRMATION_REQUIRED`.
- `backend/src/config/env.ts`: only `STRIPE_WEBHOOK_SECRET` exists; no API key setting.

## Phases (each a separate approved commit set; each gated on the previous)

### 1. SDK and configuration
- Add the official `stripe` SDK (pinned, lockfile updated, `npm ci` verified, `npm audit --omit=dev` clean).
- Add `STRIPE_SECRET_KEY` (validated, never logged) and keep `STRIPE_WEBHOOK_SECRET`. Refuse to start with a live key (`sk_live_`) unless an explicit `PAYMENTS_LIVE_ENABLED=true` owner-approved flag is set; default is test keys only.
- Secrets only via environment/secret manager; extend the error sanitizer and log redaction to cover Stripe key patterns.

### 2. Payment creation (sandbox only)
- Implement `StripePaymentProvider.createPayment` with PaymentIntents, amount/currency from the stored order (never from the client), `metadata` carrying `paymentId` and `orderId`.
- Pass our idempotency key to Stripe as `Idempotency-Key`; keep the existing DB `idempotency_key` uniqueness and one-active-payment-per-order rule.
- Initial status is `PENDING`; only a verified webhook may move a payment to `SUCCEEDED`.

### 3. Raw-body webhook verification
- Mount `express.raw({type:'application/json'})` for the Stripe webhook path before `express.json()`.
- Verify with `stripe.webhooks.constructEvent(rawBody, Stripe-Signature header, secret)` (timestamp tolerance enforced). Reject on failure with no DB writes.
- Derive event id, type, payment id and amounts from the verified event, not from client-supplied body fields.
- Map `payment_intent.succeeded` / `payment_intent.payment_failed` to the existing success/failure handling; ignore unknown event types with 2xx.
- Store the event in `payment_events (provider,event_id)` (existing primary key) for replay protection; the ledger SQL fixed in the webhook path is covered by a regression test.

### 4. Idempotency and reconciliation
- Replays are no-ops (`duplicate:true`); concurrent deliveries are serialized by the existing row locks.
- Reconcile on every event: amount, currency and provider reference must match the stored payment (existing `validatePaymentWebhookDetails`), plus a scheduled reconciliation job comparing Stripe PaymentIntents with local `payments` and `ledger_entries`; mismatches are reported to admins, never auto-corrected.

### 5. Refunds
- Implement Stripe Refunds behind an ADMIN-only route, using idempotency keys and the `refunds` table. A refund becomes `SUCCEEDED` only from a verified `refund.*`/`charge.refunded` event.
- Ledger reversal and any settlement reversal require the approved settlement policy; until then refunds stay disabled.

### 6. Sandbox test strategy
- Unit tests with a fake Stripe client; webhook signature tests using Stripe's `generateTestHeaderString`.
- Integration tests on PostgreSQL 16 covering PENDING→SUCCEEDED, failure, replay, tampered signature, amount mismatch.
- Manual end-to-end in a Stripe test-mode account with the Stripe CLI (`stripe listen`); no live keys in CI.

### 7. Connect payouts (blocked on the settlement policy)
- Requires approved policy first. Then: Connect account onboarding and KYC status per merchant/driver, `transfers` created from approved `settlement_allocation_lines`, transfer ids stored, `PAID` only after provider-confirmed transfer plus reconciliation, dual approval and a separate payout feature flag defaulting to off.
- The outbox handler stays `blockedSettlementHandler` until that phase is separately approved.

## Release gates before any live activation
1. Owner-approved settlement policy and legal/tax review.
2. All phases above merged with green PostgreSQL CI, and a Stripe test-mode soak.
3. Security review of webhook, secrets and admin routes.
4. Explicit written owner approval for live keys; no deployment without separate authorization.
