import { randomUUID } from 'node:crypto';
import Stripe from 'stripe';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { createMerchant, createUser, getPool, insertOrder, orderStatus, startApi, type TestUser } from './helpers.js';

const SECRET = 'whsec_integration_secret';
const signer = new Stripe('sk_test_integration');
const saved = { key: process.env.STRIPE_SECRET_KEY, hook: process.env.STRIPE_WEBHOOK_SECRET };

let pool: Pool;
let base: string;
let close: () => Promise<void>;
let customer: TestUser;
let merchantId: string;

beforeAll(async () => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_integration';
  process.env.STRIPE_WEBHOOK_SECRET = SECRET;
  pool = await getPool();
  ({ base, close } = await startApi());
  customer = await createUser(pool, 'CUSTOMER');
  merchantId = await createMerchant(pool, (await createUser(pool, 'MERCHANT')).id);
});
afterAll(async () => {
  await close?.();
  if (saved.key === undefined) delete process.env.STRIPE_SECRET_KEY; else process.env.STRIPE_SECRET_KEY = saved.key;
  if (saved.hook === undefined) delete process.env.STRIPE_WEBHOOK_SECRET; else process.env.STRIPE_WEBHOOK_SECRET = saved.hook;
});

const n = async (sql: string, args: unknown[] = []) => (await pool.query(sql, args)).rows[0].n as number;

async function pendingPayment(total: number) {
  const orderId = await insertOrder(pool, { customerId: customer.id, merchantId, totalCents: total });
  const paymentId = randomUUID();
  const intentId = `pi_test_${randomUUID().replace(/-/g, '')}`;
  await pool.query(
    "INSERT INTO payments(id,order_id,provider,provider_reference,amount_cents,status,idempotency_key) VALUES ($1,$2,'stripe',$3,$4,'PENDING',$5)",
    [paymentId, orderId, intentId, total, `int-stripe-${randomUUID()}`],
  );
  return { orderId, paymentId, intentId, total };
}

function event(p: { paymentId: string; intentId: string; total: number }, over: { type?: string; id?: string; received?: number; currency?: string } = {}) {
  return JSON.stringify({
    id: over.id ?? `evt_${randomUUID().replace(/-/g, '')}`,
    object: 'event',
    type: over.type ?? 'payment_intent.succeeded',
    data: { object: {
      id: p.intentId, object: 'payment_intent', amount: p.total, amount_received: over.received ?? p.total,
      currency: over.currency ?? 'usd', metadata: { paymentId: p.paymentId },
    } },
  });
}

async function post(payload: string, header?: string | null) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (header !== null) headers['stripe-signature'] = header ?? signer.webhooks.generateTestHeaderString({ payload, secret: SECRET });
  const res = await fetch(`${base}/api/payments/webhook/stripe`, { method: 'POST', headers, body: payload });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : undefined };
}

const clearing = "SELECT count(*)::int n FROM ledger_entries WHERE order_id=$1 AND account_type='PLATFORM_CLEARING' AND direction='CREDIT'";
const paymentStatus = async (id: string) => (await pool.query('SELECT status FROM payments WHERE id=$1', [id])).rows[0].status as string;

describe('Stripe sandbox webhook (signed, raw body)', () => {
  it('PENDING -> SUCCEEDED: order PAID, exactly one clearing entry, replays and new events add none', async () => {
    const p = await pendingPayment(2500);
    const payload = event(p);
    expect((await post(payload)).body).toEqual({ duplicate: false });
    expect(await paymentStatus(p.paymentId)).toBe('SUCCEEDED');
    expect(await orderStatus(pool, p.orderId)).toBe('PAID');
    expect(await n(clearing, [p.orderId])).toBe(1);
    expect((await post(payload)).body).toEqual({ duplicate: true });
    expect((await post(event(p))).body).toEqual({ duplicate: false });
    expect(await n(clearing, [p.orderId])).toBe(1);
  });

  it('creates no earnings, settlements, payouts or refunds', async () => {
    const p = await pendingPayment(900);
    await post(event(p));
    expect(await n('SELECT count(*)::int n FROM driver_earnings WHERE order_id=$1', [p.orderId])).toBe(0);
    expect(await n('SELECT count(*)::int n FROM merchant_settlements WHERE order_id=$1', [p.orderId])).toBe(0);
    expect(await n('SELECT count(*)::int n FROM refunds WHERE payment_id=$1', [p.paymentId])).toBe(0);
  });

  it('rejects a missing, wrong or mismatched signature and records nothing', async () => {
    const p = await pendingPayment(1100);
    const payload = event(p);
    const wrong = signer.webhooks.generateTestHeaderString({ payload, secret: 'whsec_wrong' });
    const forOther = signer.webhooks.generateTestHeaderString({ payload: payload + ' ', secret: SECRET });
    for (const header of [null, 'garbage', wrong, forOther]) {
      expect((await post(payload, header)).status).toBe(400);
    }
    expect(await paymentStatus(p.paymentId)).toBe('PENDING');
    expect(await orderStatus(pool, p.orderId)).toBe('PENDING_PAYMENT');
    expect(await n('SELECT count(*)::int n FROM payment_events WHERE payment_id=$1', [p.paymentId])).toBe(0);
  });

  it('reconciliation: amount, currency and provider reference mismatches are rejected and rolled back', async () => {
    const p = await pendingPayment(1300);
    const cases: Array<[string, string]> = [
      [event(p, { received: 1 }), 'WEBHOOK_AMOUNT_MISMATCH'],
      [event(p, { currency: 'eur' }), 'WEBHOOK_CURRENCY_MISMATCH'],
      [event({ ...p, intentId: 'pi_test_other' }), 'WEBHOOK_PROVIDER_REFERENCE_MISMATCH'],
    ];
    for (const [payload, error] of cases) {
      const res = await post(payload);
      expect(res.status).toBe(400);
      expect(res.body.error).toContain(error);
    }
    expect(await paymentStatus(p.paymentId)).toBe('PENDING');
    expect(await n('SELECT count(*)::int n FROM payment_events WHERE payment_id=$1', [p.paymentId])).toBe(0);
    expect(await n(clearing, [p.orderId])).toBe(0);
  });

  it('payment_failed marks the payment FAILED without paying the order or touching the ledger', async () => {
    const p = await pendingPayment(1700);
    expect((await post(event(p, { type: 'payment_intent.payment_failed', received: 0 }))).body).toEqual({ duplicate: false });
    expect(await paymentStatus(p.paymentId)).toBe('FAILED');
    expect(await orderStatus(pool, p.orderId)).toBe('PENDING_PAYMENT');
    expect(await n(clearing, [p.orderId])).toBe(0);
  });

  it('ignores unrelated signed events', async () => {
    const p = await pendingPayment(400);
    const res = await post(event(p, { type: 'charge.refunded' }));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ignored: true });
    expect(await paymentStatus(p.paymentId)).toBe('PENDING');
  });

  it('never trusts client-supplied JSON fields on the stripe route', async () => {
    const p = await pendingPayment(600);
    const res = await post(JSON.stringify({
      eventId: `evt_${randomUUID()}`, type: 'PAYMENT_SUCCEEDED', paymentId: p.paymentId, status: 'SUCCEEDED',
      amountCents: 600, currency: 'USD', providerReference: p.intentId, rawBody: '{}', signature: 'sig',
    }), null);
    expect(res.status).toBe(400);
    expect(await paymentStatus(p.paymentId)).toBe('PENDING');
    expect(await orderStatus(pool, p.orderId)).toBe('PENDING_PAYMENT');
  });

  it('is disabled again when the secrets are removed, and refuses live keys', async () => {
    const p = await pendingPayment(500);
    const payload = event(p);
    const key = process.env.STRIPE_SECRET_KEY;
    try {
      process.env.STRIPE_SECRET_KEY = 'sk_live_forbidden';
      expect((await post(payload)).status).toBe(503);
      delete process.env.STRIPE_SECRET_KEY;
      expect((await post(payload)).status).toBe(503);
    } finally { process.env.STRIPE_SECRET_KEY = key; }
    expect(await paymentStatus(p.paymentId)).toBe('PENDING');
  });
});
