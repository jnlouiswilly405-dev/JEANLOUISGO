# Payment webhook event integrity gate

## Implemented in recovery v32

- The webhook route accepts only the configured provider names (`mock`, `stripe`).
- The request schema accepts only `PAYMENT_SUCCEEDED` and `PAYMENT_FAILED` event labels.
- The service independently checks that the event label and status agree before signature verification or database writes.
- Unknown event labels and contradictory event/status combinations fail closed.

## Important limitations

This is an internal event contract, not a claim of live Stripe compatibility. The Stripe adapter remains disabled until the official provider SDK, raw-body signature verification, provider API calls, and reconciliation are implemented. Mock verification is test/development-only and is not production payment security.

The event envelope is still supplied by the caller. A live provider adapter must parse the provider's authenticated raw payload and derive event ID, type, payment reference, amount, currency, and status from that verified payload rather than trusting parallel caller-supplied fields.

## Release gate

Do not enable production payment processing until provider-authenticated payload parsing, amount/currency/reference matching, replay protection, idempotent state transitions, and end-to-end integration tests are complete.
