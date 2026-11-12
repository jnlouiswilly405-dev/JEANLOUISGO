# Stripe sandbox end-to-end test (opt-in)

**Status: ON HOLD — pending external auditor assistance.** Prior manual runs stopped at the key-format guard before the E2E body ran.
The key is masked in Actions logs, so its specific format cannot be determined. Do not rerun this workflow while it is on hold.
The strict validator has not yet been verified by a successful manual run. Normal CI does not require Stripe credentials.

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
dashboard (Developers → API keys, Test mode). A restricted key must permit the PaymentIntent operations exercised
by the test. Never paste it into chat, source files, CI logs or a committed `.env`.

```bash
export DATABASE_URL=postgres://user:pass@localhost:5432/xxx_test   # database name must end in _test
export STRIPE_SECRET_KEY=sk_test_...                  # or rk_test_...; test mode only, surrounding whitespace is trimmed
export STRIPE_SANDBOX_E2E=1
npm run test:int --workspace backend -- stripe-sandbox-e2e
```

Safety guards: the file trims surrounding whitespace, throws immediately on an `sk_live_`/`rk_live_` key,
and only runs for a complete `sk_test_[A-Za-z0-9]+` or `rk_test_[A-Za-z0-9]+` key. The backend provider
(`readStripeSandboxConfig`) independently applies the same test-key allowlist and rejects live keys.

## Environment variables
| Variable | Used by | Value | Required |
|---|---|---|---|
| `DATABASE_URL` | E2E test | local/CI PostgreSQL; name must end in `_test` | yes |
| `STRIPE_SECRET_KEY` | E2E test, backend | Complete `sk_test_[A-Za-z0-9]+` or `rk_test_[A-Za-z0-9]+`; surrounding whitespace is trimmed; live keys abort | yes |
| `STRIPE_SANDBOX_E2E` | E2E test | `1` to enable (otherwise skipped) | yes |
| `STRIPE_WEBHOOK_SECRET` | backend | the automated E2E sets a throwaway value itself; real `whsec_...` (from `stripe listen`) only for the manual browser check | no (E2E) |
| `VITE_STRIPE_PUBLISHABLE_KEY` | customer app | `pk_test_...` only | manual browser check |

If `STRIPE_SANDBOX_E2E=1` is set with a non-test key the file throws instead of silently skipping.

## Manual GitHub Actions run (`.github/workflows/stripe-sandbox-e2e.yml`)
Dispatch-only; it never runs on push or pull request, and normal CI never sets the Stripe variables
(a unit test, `sandbox-e2e-guard.test.ts`, enforces this). Configure the credential once:
1. Repo → Settings → Environments → New environment `stripe-sandbox`; add yourself as **required reviewer**.
2. In that environment add secret `STRIPE_TEST_SECRET_KEY` = your Stripe **test-mode** secret key (Stripe dashboard, Test mode on → Developers → API keys). Only enter it in the GitHub UI; do not print or expose the value.
3. Actions → "Stripe Sandbox E2E (manual, test mode only)" → Run workflow → type `SANDBOX` → approve the deployment.
4. The workflow trims surrounding whitespace and accepts only complete `sk_test_[A-Za-z0-9]+` or `rk_test_[A-Za-z0-9]+` values, without printing the key; it applies schema and migrations to throwaway PostgreSQL and runs only this E2E test.
The latest observed run did not pass the key-format guard, so **E2E remains pending external auditor assistance**. An authorized owner/auditor must privately validate the protected environment configuration before a new, approved run. The secret value is not available for inspection through this workflow review; never share it in chat or logs, and rotate it if it is ever exposed.

## Manual browser check (customer app)
1. Run the backend with `STRIPE_SECRET_KEY` (`sk_test_` or `rk_test_`) and `STRIPE_WEBHOOK_SECRET` (from `stripe listen`) set.
2. Run `stripe listen --forward-to localhost:4000/api/payments/webhook/stripe` (Stripe CLI, test mode).
3. Start the customer app with `VITE_STRIPE_PUBLISHABLE_KEY=pk_test_...`; place an order and pay with card `4242 4242 4242 4242`.
4. The order should move to PAID only after the webhook arrives. The app refuses any key not starting with `pk_test_`.

## Known gap
If the webhook arrives before the backend stored the intent reference, reconciliation relies on the adoption logic described
in `docs/WEBHOOK_EARLY_ARRIVAL_RACE.md`.
