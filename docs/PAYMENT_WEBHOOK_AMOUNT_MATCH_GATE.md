# Payment webhook amount and identity matching gate

## Required webhook details

The internal webhook contract now requires `amountCents`, `currency`, and `providerReference` in addition to the payment and event identifiers. Before a payment state transition or ledger write, the service compares these values with the stored payment and its order:

- Amount must be a positive safe integer in minor units and exactly match the stored payment amount.
- Currency must be a three-letter code and match the order currency (case-insensitive comparison).
- Provider reference must exactly match the reference returned when the payment was created.

A mismatch rejects the webhook transaction. The provider-scoped event key remains `(provider,event_id)`.

## Important limitation

This is an additional consistency gate, not proof of provider authenticity. The mock adapter is test/development only. Stripe remains disabled until its official SDK/API integration, raw-request-body signature verification, replay protection, and reconciliation are implemented. Do not enable live payments based on this validation alone.
