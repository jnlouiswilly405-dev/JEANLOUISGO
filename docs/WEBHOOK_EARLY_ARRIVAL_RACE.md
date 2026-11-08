# Stripe webhook early-arrival race (analysis only; not implemented)

## Behaviour after commit `c3b594c`
`createPayment` (stripe) commits a `PENDING` payment with `provider_reference = NULL`, then calls Stripe, then stores the reference.
If `payment_intent.succeeded` is delivered between Stripe creating the intent and our reference update, `handleWebhook`
locks the payment row, `validatePaymentWebhookDetails` compares `providerReference` and fails, the route returns 400, and Stripe retries
(with backoff, for days). No state is corrupted: nothing is marked paid and no ledger entry is written.

The same applies if the process crashes after Stripe created the intent: the row stays `PENDING` with a NULL reference until the
same idempotency key is replayed (which resumes with the same Stripe idempotency key and returns the same intent).

Realistic window: a card must be confirmed client-side using the `clientSecret`, which is only returned after the reference is stored,
so the succeeded event can normally only precede the reference update on a crash or a lost HTTP response. Risk is low.

## Options
| Option | Change | Risk |
|---|---|---|
| A. Accept (current) | none; Stripe retries until the reference is set | Delay only. Requires the client to replay the same key after a crash. |
| B. Adopt the reference in the webhook | If `provider_reference IS NULL` and `metadata.paymentId` matches a PENDING payment, with amount and currency matching, set the reference from the verified event, then proceed | Touches the webhook path that writes ledger entries: needs owner approval and tests. Verified signature plus matching amount/currency keeps it safe. |
| C. Reconciliation job | A read-only job lists `PENDING` stripe payments with NULL reference older than N minutes and reports them (or retrieves the intent by the idempotency key) | Operational only; no financial writes if reporting only. |

Recommendation: keep A now, add C (report-only) as the first follow-up, and consider B only after the Stripe sandbox test cycle and owner approval.
No financial change is made by this document.
