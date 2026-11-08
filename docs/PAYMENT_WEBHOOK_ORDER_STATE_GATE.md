# Payment webhook order-state gate

A provider-authenticated `PAYMENT_SUCCEEDED` event is not sufficient by itself to
finalize an order. The payment service locks the payment and its order, validates
the provider reference, amount, and currency, then permits success only when the
order is `PENDING_PAYMENT` or already `PAID`.

Other order states (including cancelled, delivered, or otherwise closed states)
are rejected with `WEBHOOK_ORDER_STATE_BLOCKED`. This prevents a late or replayed
success event from creating a clearing-ledger credit against an order that has
moved beyond the payable lifecycle.

This is a defensive state gate, not proof of a live processor integration.
Stripe remains disabled until its official API adapter, raw-body signature
verification, idempotency, and reconciliation are implemented. Database and
runtime integration tests must still be run in an environment with PostgreSQL
and installed project dependencies.
