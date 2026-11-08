# Report-only reconciliation design: stripe payments without a provider reference

Design only. Nothing here is implemented and webhook financial behaviour is unchanged (an early webhook still returns 400 and Stripe retries).
Context: `WEBHOOK_EARLY_ARRIVAL_RACE.md`.

## Goal
Surface stripe payments stuck as `PENDING` with `provider_reference IS NULL` (crash or ambiguous network error between the
commit and the reference update) so an operator can act. It must never change money state.

## Query (read-only)
```sql
SELECT id, order_id, amount_cents, created_at, now() - created_at AS age
FROM payments
WHERE provider = 'stripe' AND status = 'PENDING' AND provider_reference IS NULL
  AND created_at < now() - make_interval(mins => $1)
ORDER BY created_at
LIMIT $2 OFFSET $3;
```
Existing columns only; no schema or migration change. Default threshold 15 minutes.

## Surface
`GET /api/admin/payments/unreferenced` (ADMIN only, same `requireAuth` + `requireRole('ADMIN')` pattern and pagination as
`GET /api/admin/outbox/blocked`). Returns id, order id, amount, currency, created_at, age. Never returns idempotency keys, client secrets or Stripe keys.

## Explicit non-goals
No automatic Stripe retrieval, no writes to `payments`, `orders` or `ledger_entries`, no status changes, no notifications that move money.
Resolution stays manual: the customer replays the same idempotency key, which resumes the original intent safely.

## Tests to add when approved
Admin gets the stuck rows; customer/driver/merchant get 403 and anonymous 401; rows younger than the threshold, referenced rows, non-stripe rows and
non-PENDING rows are excluded; pagination; the endpoint creates no ledger entries.

## Later options (separate approval)
Retrieve the intent by metadata for a read-only comparison; webhook adoption of the reference (financial path, needs explicit approval).
