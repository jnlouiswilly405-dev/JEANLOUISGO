# Payment Provider Release Gate

## Current state: LIVE PAYMENTS BLOCKED

The current `stripe` selection is not a production Stripe integration. The previous generic HMAC adapter generated synthetic provider references and did not call Stripe's API or verify Stripe webhook signatures using the official raw-body protocol.

The provider factory now fails closed for every live provider with `PAYMENT_PROVIDER_NOT_IMPLEMENTED`. The mock adapter remains available only in `test` and `development` environments. Refund creation also fails closed with `REFUND_PROVIDER_NOT_IMPLEMENTED`; the application must not create a local successful-refund record without processor confirmation.

## Required before enabling live payments

1. Implement the official Stripe SDK/API integration and server-side payment intent creation.
2. Verify webhook signatures using the exact raw request body and Stripe's official signature verifier.
3. Persist provider event IDs idempotently and validate event-to-payment ownership, amount, currency, and status transitions.
4. Add provider refund API calls and reconcile provider-confirmed refund outcomes before creating successful refund records or ledger updates.
5. Add automated tests for valid/invalid signatures, duplicate events, replay, amount/currency mismatch, partial refunds, and provider/API failures.
6. Configure secrets only in the deployment secret manager; never commit credentials.
7. Complete sandbox reconciliation and obtain owner approval before production activation.

Do not treat a successful mock payment as evidence of a real captured payment. Do not enable payouts until provider reconciliation and the separate settlement financial policy gate are approved.


## Refund safety added in recovery v29

The previous local-only refund path inserted a `SUCCEEDED` refund and a customer-refund ledger debit without calling a payment processor. That path is now disabled. The refund endpoint returns a controlled conflict until an official provider refund operation and its reconciliation tests exist. This deliberately favors a blocked refund over a false financial success.
