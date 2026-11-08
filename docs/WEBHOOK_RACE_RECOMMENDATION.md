# Webhook early-arrival race — analysis and recommended idempotent solution (NOT implemented)

Webhook financial behaviour is unchanged. This extends `WEBHOOK_EARLY_ARRIVAL_RACE.md`.

## Current behaviour, verified from `handleWebhook`
1. The event row is inserted into `payment_events` (`ON CONFLICT (provider,event_id) DO NOTHING`) **inside the same transaction** as the payment update.
2. If the payment's `provider_reference` is still NULL, `validatePaymentWebhookDetails` throws, the transaction **rolls back (including the `payment_events` insert)**, the route returns 400 and Stripe retries.
So an early event is neither lost nor marked as processed: it is re-delivered and succeeds once the reference is stored. Duplicate deliveries after success hit the `ON CONFLICT` and return `{ duplicate: true }` with no second ledger entry (covered by the existing integration tests).

## Failure modes that remain
1. Crash/lost response after Stripe created the intent: the row stays `PENDING` with a NULL reference until the customer replays the same idempotency key. Until then every webhook retry fails; Stripe stops retrying after its retry window (about 3 days in live mode), after which a succeeded payment could remain `PENDING` locally. This is the real risk, and it is detectable: `GET /api/admin/payments/unreferenced`.
2. Operator visibility only; nothing repairs it automatically.

## Recommended solution (needs approval because it touches the financial path)
Adopt the reference from the **verified** event when, and only when, all of these hold, in the same transaction and under the existing `FOR UPDATE` row lock:
- signature verified (already enforced before any DB work);
- `payments.provider = 'stripe'`, `status = 'PENDING'`, `provider_reference IS NULL`;
- `metadata.paymentId` of the event equals `payments.id` (already derived from the verified event);
- amount and currency equal the stored payment and order values (already compared);
- the intent id is not already attached to another payment (`provider_reference` is UNIQUE, so a conflict aborts).
Then `UPDATE payments SET provider_reference=$ref WHERE id=$1 AND provider_reference IS NULL` and continue with the existing success path. Idempotency is unchanged: the event insert still guards duplicates, the update is guarded by `IS NULL`, and the ledger insert remains once-only.

Properties: no new money movement; same single PLATFORM_CLEARING credit; no schema change; cannot be triggered without a valid Stripe signature.

## Alternatives rejected or deferred
- Retrieve the intent from Stripe on demand during the webhook: adds a network call inside the transaction (the problem fixed in `c3b594c`).
- Reconcile by a background job writing state: more moving parts and writes; keep the existing report-only endpoint first.

## Required tests when approved
Early `payment_intent.succeeded` with NULL reference becomes SUCCEEDED once, with exactly one ledger entry; replay returns duplicate; mismatched amount, currency or paymentId is rejected with no state change; a reference already used by another payment is rejected; FAILED events unaffected; a later createPayment reply does not overwrite the adopted reference (guarded by `IS NULL`).

Decision needed from the owner: approve the adoption change, or keep the current behaviour with the report endpoint and an operational runbook.

> UPDATE (98189cc): the reference-adoption proposal is IMPLEMENTED for verified SUCCEEDED Stripe sandbox events (single-use, amount/currency reconciled, same transaction, tests in `backend/integration/stripe-webhook-adoption.int.ts`). The payment row lock now precedes the event insert to avoid concurrent-event deadlocks.
