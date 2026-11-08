# Stripe sandbox end-to-end test (opt-in)

**Status: written and type-checked, NOT executed.** No Stripe test credentials were available in the recovery
environment, and none were requested. It is skipped in CI and in every normal `npm run test:int` run.

Test: `backend/integration/stripe-sandbox-e2e.int.ts`

## What it proves when you run it
1. `POST /api/payments` creates a real **test-mode** PaymentIntent and returns a `clientSecret`; the order stays unpaid.
2. The intent is confirmed server-side with Stripe's test card token `pm_card_visa` (`livemode` must be `false`).
   Confirming with Stripe alone still does not make the order PAID.
3. A `payment_intent.succeeded` event built from the real intent is signed **locally** with a throwaway secret and posted to
   `POST /api/payments/webhook/stripe`. The order becomes PAID with exactly one `PLATFORM_CLEARING` credit; a replay adds nothing.
4. No `driver_earnings`, `merchant_settlements` or `payout_batches` rows are created.

It does not exercise Stripe delivering a webhook to a public URL, the browser Payment Element, refunds or Connect.

## How to run (owner, on a machine you control)
Use a Stripe **test-mode** secret key from the Stripe dashboard (Developers → API keys, "Test mode"). Never paste it into
chat, source files, CI logs or a committed `.env`.

```bash
export DATABASE_URL=postgres://user:pass@localhost:5432/xxx_test   # database name must end in _test
export STRIPE_SECRET_KEY=sk_test_...                               # test mode only
export STRIPE_SANDBOX_E2E=1
npm run test:int --workspace backend -- stripe-sandbox-e2e
```

Safety guards: the file throws immediately on an `sk_live_`/`rk_live_` key, only runs for `sk_test_` keys, and the backend
provider (`readStripeSandboxConfig`) independently refuses live keys.

## Manual browser check (customer app)
1. Run the backend with `STRIPE_SECRET_KEY` (`sk_test_`) and `STRIPE_WEBHOOK_SECRET` (from `stripe listen`) set.
2. Run `stripe listen --forward-to localhost:4000/api/payments/webhook/stripe` (Stripe CLI, test mode).
3. Start the customer app with `VITE_STRIPE_PUBLISHABLE_KEY=pk_test_...`; place an order and pay with card `4242 4242 4242 4242`.
4. The order should move to PAID only after the webhook arrives. The app refuses any key not starting with `pk_test_`.

## Known gap
If the webhook arrives before the backend stored the intent reference, reconciliation relies on the adoption logic described
in `docs/WEBHOOK_EARLY_ARRIVAL_RACE.md`.
