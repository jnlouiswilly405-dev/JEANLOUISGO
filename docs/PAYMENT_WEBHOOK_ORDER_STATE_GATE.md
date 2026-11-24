# Payment webhook order-state gate

A provider-authenticated `PAYMENT_SUCCEEDED` event is not sufficient by itself to
finalize an order. The payment service locks the payment and its order, validates
the provider reference, amount, and currency, then permits success only when the
order is `PENDING_PAYMENT` or already `PAID`. For an already-succeeded payment,
a distinct success event is acknowledged after checking that its clearing credit
matches, including after the order advances beyond `PAID`.

Other order states (including cancelled, delivered, or otherwise closed states)
are rejected with `WEBHOOK_ORDER_STATE_BLOCKED`. This prevents a late or replayed
success event from creating a clearing-ledger credit against an order that has
moved beyond the payable lifecycle.

This is a defensive state gate, not proof of production readiness. The Stripe
adapter is sandbox-only; live processing, refunds, and payouts remain disabled.
Checkout recovery and complete financial reconciliation remain release gates.

For a pending Stripe attempt with a recorded reference, same-key replay
retrieves the existing intent and verifies its reference, metadata, amount,
currency and actionable status before returning its client secret. The secret
is not stored. A pending attempt without a recorded reference may be retried
with the same key only during the first 23 hours; older attempts require manual
reconciliation rather than a potentially new intent. The customer app retains
the attempt key in session storage for same-tab reloads, not across devices or
closed browser sessions. Those recovery cases remain a release gate.

Stripe's `payment_intent.payment_failed` can represent a retryable confirmation
failure, so the existing attempt remains `PENDING` and prevents creation of a
second attempt. A separate verified success for another payment or an unmatched
clearing credit is rejected with `PAYMENT_LEDGER_RECONCILIATION_REQUIRED`; it
requires manual investigation of the real provider capture and must not be
treated as proof that no money moved.

Migration 019 enforces one platform-clearing credit per order without deleting
or changing historical entries. If duplicates exist it fails: back up the
database, investigate and reconcile them with an authorized financial operator
before retrying. It does not link credits to individual payments.
