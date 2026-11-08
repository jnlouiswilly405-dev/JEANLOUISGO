import { randomUUID } from 'node:crypto';
import Stripe from 'stripe';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { api, createMerchant, createUser, getPool, insertOrder, orderStatus, startApi, type TestUser } from './helpers.js';

/**
 * OPT-IN Stripe SANDBOX end-to-end test. It is skipped unless STRIPE_SANDBOX_E2E=1 and STRIPE_SECRET_KEY is a
 * Stripe TEST key (sk_test_...). Live keys abort the file. No real money can move: only test-mode objects and
 * the Stripe test card token pm_card_visa are used. See docs/STRIPE_SANDBOX_E2E.md.
 *
 * Flow: real backend -> real Stripe test-mode PaymentIntent -> test-card confirmation -> a webhook signed locally
 * with a throwaway secret -> order PAID, exactly one PLATFORM_CLEARING credit, replay adds nothing.
 */
const key = process.env.STRIPE_SECRET_KEY?.trim() ?? '';
if (/^(sk|rk)_live_/.test(key)) throw new Error('STRIPE_LIVE_KEYS_FORBIDDEN: refusing to run against a live key');
if (process.env.STRIPE_SANDBOX_E2E === '1' && !/^sk_test_[A-Za-z0-9]+$/.test(key)) throw new Error('STRIPE_SANDBOX_E2E=1 requires an sk_test_ key; refusing to report a silent skip as success');
const enabled = process.env.STRIPE_SANDBOX_E2E === '1' && /^sk_test_[A-Za-z0-9]+$/.test(key);

const WEBHOOK_SECRET = 'whsec_local_e2e_only';
const saved = { hook: process.env.STRIPE_WEBHOOK_SECRET };

let pool: Pool;
let base: string;
let close: () => Promise<void>;
let customer: TestUser;
let merchantId: string;

beforeAll(async () => {
  if (!enabled) return;
  process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
  pool = await getPool();
  ({ base, close } = await startApi());
  customer = await createUser(pool, 'CUSTOMER');
  merchantId = await createMerchant(pool, (await createUser(pool, 'MERCHANT')).id);
});
afterAll(async () => {
  await close?.();
  if (saved.hook === undefined) delete process.env.STRIPE_WEBHOOK_SECRET; else process.env.STRIPE_WEBHOOK_SECRET = saved.hook;
});

const clearing = "SELECT count(*)::int n FROM ledger_entries WHERE order_id=$1 AND account_type='PLATFORM_CLEARING' AND direction='CREDIT'";

describe.skipIf(!enabled)('Stripe sandbox end-to-end (opt-in)', () => {
  it('creates a real test-mode intent, confirms it with a test card and reconciles through a signed webhook', async () => {
    const stripe = new Stripe(key);
    const tables = ['driver_earnings', 'merchant_settlements', 'payout_batches'];
    const before: Record<string, number> = {};
    for (const t of tables) before[t] = (await pool.query(`SELECT count(*)::int n FROM ${t}`)).rows[0].n;
    const total = 1250;
    const orderId = await insertOrder(pool, { customerId: customer.id, merchantId, totalCents: total });

    const created = await api(base, 'POST', '/api/payments', {
      token: customer.token,
      body: { orderId, provider: 'stripe', amountCents: total, idempotencyKey: `e2e-${randomUUID()}` },
    });
    expect(created.status).toBe(201);
    expect(created.body.status).toBe('PENDING');
    expect(created.body.clientSecret).toMatch(/^pi_.+_secret_/);
    expect(await orderStatus(pool, orderId)).not.toBe('PAID');

    const intentId = (created.body.clientSecret as string).split('_secret_')[0];
    const confirmed = await stripe.paymentIntents.confirm(intentId, { payment_method: 'pm_card_visa', return_url: 'https://example.test/return' });
    expect(confirmed.status).toBe('succeeded');
    expect(confirmed.livemode).toBe(false);
    // Confirming with Stripe alone must not change our order; only the verified webhook may.
    expect(await orderStatus(pool, orderId)).not.toBe('PAID');

    const payload = JSON.stringify({ id: `evt_${randomUUID().replace(/-/g, '')}`, object: 'event', type: 'payment_intent.succeeded', data: { object: confirmed } });
    const header = stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
    const post = () => fetch(`${base}/api/payments/webhook/stripe`, { method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': header }, body: payload });

    expect((await post()).status).toBe(200);
    expect(await orderStatus(pool, orderId)).toBe('PAID');
    expect((await pool.query(clearing, [orderId])).rows[0].n).toBe(1);
    expect((await post()).status).toBe(200);
    expect((await pool.query(clearing, [orderId])).rows[0].n).toBe(1);

    for (const table of tables) {
      expect((await pool.query(`SELECT count(*)::int n FROM ${table}`)).rows[0].n).toBe(before[table]);
    }
  });
});
