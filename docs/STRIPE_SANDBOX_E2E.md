# Stripe sandbox end-to-end test (opt-in)

**Status: BLOCKED — the latest run's nonempty, masked value matched neither supported test-key prefix**
(`sk_test_` or `rk_test_`); the E2E test body has not executed. The logs do not identify the value or its type.
Normal CI remains independent and does not require Stripe credentials.

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
Use a Stripe **test-mode** secret key (`sk_test_...`) or restricted test-mode key (`rk_test_...`) from the Stripe
dashboard (Developers → API keys, Sandbox). A restricted key must permit the PaymentIntent operations exercised
by the test. Never paste it into chat, source files, CI logs or a committed `.env`.

```bash
export DATABASE_URL=postgres://user:pass@localhost:5432/xxx_test   # database name must end in _test
export STRIPE_SECRET_KEY=sk_test_...                               # or rk_test_...; test mode only
export STRIPE_SANDBOX_E2E=1
npm run test:int --workspace backend -- stripe-sandbox-e2e
```

Safety guards: the file throws immediately on an `sk_live_`/`rk_live_` key, only runs for `sk_test_` or `rk_test_`
keys, and the backend provider (`readStripeSandboxConfig`) independently refuses live keys.

## Environment variables
| Variable | Used by | Value | Required |
|---|---|---|---|
| `DATABASE_URL` | E2E test | local/CI PostgreSQL; name must end in `_test` | yes |
| `STRIPE_SECRET_KEY` | E2E test, backend | `sk_test_...` or `rk_test_...` only; `sk_live_`/`rk_live_` abort | yes |
| `STRIPE_SANDBOX_E2E` | E2E test | `1` to enable (otherwise skipped) | yes |
| `STRIPE_WEBHOOK_SECRET` | backend | the automated E2E sets a throwaway value itself; real `whsec_...` (from `stripe listen`) only for the manual browser check | no (E2E) |
| `VITE_STRIPE_PUBLISHABLE_KEY` | customer app | `pk_test_...` only | manual browser check |

If `STRIPE_SANDBOX_E2E=1` is set with a non-test key the file throws instead of silently skipping.

## Manual GitHub Actions run (`.github/workflows/stripe-sandbox-e2e.yml`)
Dispatch-only; it never runs on push or pull request, and normal CI never sets the Stripe variables
(a unit test, `sandbox-e2e-guard.test.ts`, enforces this). Configure the credential once:
1. Repo → Settings → Environments → New environment `stripe-sandbox`; add yourself as **required reviewer**.
2. In that environment add secret `STRIPE_TEST_SECRET_KEY` = your Stripe **test-mode** secret key (Stripe dashboard, Test mode toggle on → Developers → API keys). Enter it only in the GitHub UI.
3. Actions → "Stripe Sandbox E2E (manual, test mode only)" → Run workflow → type `SANDBOX` → approve the deployment.
4. The workflow checks the key starts with `sk_test_` or `rk_test_` (without printing it), applies schema and migrations to a throwaway PostgreSQL, and runs only the E2E test.
Status stays **BLOCKED** until a valid test key is configured and a run succeeds. GitHub masks secrets in logs; still, rotate the key if it is ever pasted anywhere else.

## Manual browser check (customer app)
1. Run the backend with `STRIPE_SECRET_KEY` (`sk_test_` or `rk_test_`) and `STRIPE_WEBHOOK_SECRET` (from `stripe listen`) set.
2. Run `stripe listen --forward-to localhost:4000/api/payments/webhook/stripe` (Stripe CLI, test mode).
3. Start the customer app with `VITE_STRIPE_PUBLISHABLE_KEY=pk_test_...`; place an order and pay with card `4242 4242 4242 4242`.
4. The order should move to PAID only after the webhook arrives. The app refuses any key not starting with `pk_test_`.

## Known gap
If the webhook arrives before the backend stored the intent reference, reconciliation relies on the adoption logic described
in `docs/WEBHOOK_EARLY_ARRIVAL_RACE.md`.
