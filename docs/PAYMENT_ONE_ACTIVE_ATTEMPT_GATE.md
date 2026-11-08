# Payment One-Active-Attempt Gate

## Risk addressed

A caller could submit the same order with two different idempotency keys. The existing idempotency lock only serialized requests sharing a key, so separate keys could otherwise create multiple pending processor attempts for one order.

## Guard added

`createPayment` locks the order row, checks for an existing `PENDING` or `SUCCEEDED` payment, and rejects a second attempt. The order row lock serializes this check across distinct idempotency keys. A prior `FAILED` attempt does not block a retry with a new key. A retry of the original request must reuse its original idempotency key and receives the existing payment record.

## Boundaries

This is a database-side concurrency guard, not a replacement for processor-side idempotency. A real provider adapter must still send a stable idempotency key to the processor and reconcile ambiguous network outcomes. External provider creation currently occurs inside the database transaction; production integration should revisit that boundary using a durable attempt/outbox pattern to avoid orphaned processor-side intents if the database transaction rolls back.

## Validation status

Static assertions cover the query, error gate, and unit-test cases. PostgreSQL concurrency behavior and Vitest execution remain unverified until dependencies and a PostgreSQL service are available.
