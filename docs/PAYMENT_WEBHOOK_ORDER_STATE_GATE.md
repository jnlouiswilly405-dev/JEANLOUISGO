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

Signed `payment_intent.canceled` events verify both payment and order metadata,
provider reference, amount and currency, then close only a still-pending attempt
as `FAILED`; they never move the order or create a ledger entry. A customer may
cancel their own unpaid `PENDING_PAYMENT` order. If a Stripe intent is active,
the backend cancels and verifies that exact intent before changing order state.
An unresolved intent without a reference is blocked for reconciliation.
Captured/fulfilled orders cannot be canceled because refunds are disabled.
Payment, assignment and delivery states cannot be set through the generic order
status endpoint; dispatch and delivery require one matching successful payment
and clearing credit.

The authenticated `GET /api/payments/orders/:orderId/recover` returns the
existing customer's actionable pending intent, checking provider ID, metadata,
amount, currency and Stripe status. It allows a customer who has signed in on
another device or reopened the application to resume without a client-held key.
When the provider reference was never recorded, the backend retries creation
with its saved Stripe idempotency key only during the first 23 hours. Older
ambiguous attempts are stopped for manual reconciliation; the client secret is
never persisted.

Migration 019 enforces one platform-clearing credit per order without deleting
or changing historical entries. If duplicates exist it fails: back up the
database, investigate and reconcile them with an authorized financial operator
before retrying. It does not link credits to individual payments.

`HISTORICAL_LEDGER_AUDIT_019.md` describes an authorized, read-only snapshot
audit required before migration 019. No production/historical audit was run and
the migration remains unapplied by this task.
