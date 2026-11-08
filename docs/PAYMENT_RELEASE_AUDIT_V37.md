# JEANLOUISGO v1.1.1 — Payment Release Audit (v37)

Date: 2026-11-02  
Scope: Static source review of the payment routes, service, and provider adapter. This is a code review note, not a live payment certification.

## Confirmed safeguards

- Live providers are deliberately rejected by `getProvider`; Stripe is not enabled.
- The mock provider is restricted to `test` and `development`.
- Payment creation validates order state, amount, idempotency key, and the one-active-attempt rule.
- Webhook processing checks provider, event type/status, amount, currency, and provider reference.
- Duplicate provider event IDs are ignored through the `(provider,event_id)` uniqueness path.
- Refunds are explicitly disabled until processor confirmation and reconciliation exist.

## Release blockers before real-money use

1. **No real Stripe integration:** no official SDK PaymentIntent creation or processor-side confirmation flow is implemented.
2. **Webhook raw-body handling is not production-ready:** the route accepts `rawBody` as a JSON field. A real Stripe endpoint must verify the exact raw HTTP request bytes with Stripe's official signature-verification method before parsing the event.
3. **Mock webhook verification is intentionally permissive:** `MockPaymentProvider.verifyWebhook()` always returns true. Keep this strictly isolated to test/development and never expose mock mode in production.
4. **External provider call is inside the database transaction:** `createPayment()` invokes the adapter while holding database locks. Before a live provider is introduced, use a durable payment-attempt state/outbox or another recoverable workflow so processor latency/timeouts cannot leave long-held locks or ambiguous attempts.
5. **No provider reconciliation/refund workflow:** refunds, disputes, chargebacks, and periodic processor-to-ledger reconciliation must be implemented and tested before launch.

## Recommended implementation order

1. Keep live payments disabled.
2. Implement a durable `CREATING`/`PENDING` payment-attempt lifecycle and retry/reconciliation strategy.
3. Add Stripe official SDK calls and idempotency at the processor boundary.
4. Capture raw request bytes in Express and verify Stripe signatures before trusting event fields.
5. Persist provider event IDs and normalized event data only after successful signature verification.
6. Add Stripe test-mode integration tests for success, failure, duplicate delivery, delayed delivery, amount/currency mismatch, and timeout/retry cases.
7. Implement confirmed refunds and ledger reconciliation.
8. Only then review production secrets and enable live mode.

## Validation status

- Static QA: run separately as part of this recovery package.
- PostgreSQL integration tests: not executed in this environment.
- TypeScript build/Vitest: not verified because dependency installation previously timed out.
- Stripe test/live transactions: not executed; live provider remains disabled.

**Decision:** retain the current release gate. The backend may continue through non-payment QA, but JEANLOUISGO is not cleared to accept real payments.
