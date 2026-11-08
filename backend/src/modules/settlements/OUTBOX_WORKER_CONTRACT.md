# Settlement Outbox Worker Contract

The worker provides **at-least-once delivery**, not exactly-once execution.

## Handler requirements
- A handler must be idempotent using the event's stable `dedupe_key` as its operation key.
- A handler must validate `event_type`, `aggregate_type`, and payload shape before acting.
- A handler must not mark a driver earning or merchant settlement `PAID` merely because the event was consumed.
- A payout can be considered complete only after provider confirmation is verified and reconciled.
- A handler should finish within the five-minute lease or implement a lease-renewal strategy before long-running work.

## Concurrency and stale workers
The worker claims rows with `FOR UPDATE SKIP LOCKED`, assigns a fresh lease token, and only updates the row if it still owns that token. If the lease expires and another worker claims the event, the older worker cannot mark the event processed.

A lease token cannot undo an external side effect already performed by an old worker. Therefore provider calls must use a stable idempotency key derived from `dedupe_key`; without provider-side idempotency, duplicate external actions remain possible.

## Retry behavior
Failures are retried with a bounded delay. After the configured attempt limit, the event becomes `BLOCKED` and requires operational review. The worker does not silently discard blocked events.
