import { randomUUID } from 'node:crypto';
import Stripe from 'stripe';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { api, createMerchant, createUser, getPool, insertOrder, orderStatus, startApi, type TestUser } from './helpers.js';

// Early-arrival recovery: a verified payment_intent.succeeded may supply the missing provider reference.
const SECRET = 'whsec_integration_adoption';
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
const clearing = "SELECT count(*)::int n FROM ledger_entries WHERE order_id=$1 AND account_type='PLATFORM_CLEARING' AND direction='CREDIT'";
const intent = () => `pi_early_${randomUUID().replace(/-/g, '')}`;

/** A payment exactly as createPayment leaves it before the reference is stored. */
async function unreferenced(total: number, idempotencyKey = `int-adopt-${randomUUID()}`) {
  const orderId = await insertOrder(pool, { customerId: customer.id, merchantId, totalCents: total });
  const paymentId = randomUUID();
  await pool.query(
    "INSERT INTO payments(id,order_id,provider,provider_reference,amount_cents,status,idempotency_key) VALUES ($1,$2,'stripe',NULL,$3,'PENDING',$4)",
    [paymentId, orderId, total, idempotencyKey],
  );
  return { orderId, paymentId, total, idempotencyKey };
}
const row = async (id: string) => (await pool.query('SELECT status,provider_reference FROM payments WHERE id=$1', [id])).rows[0] as { status: string; provider_reference: string | null };

function event(p: { paymentId: string; total: number }, intentId: string, over: { type?: string; received?: number; currency?: string; id?: string } = {}) {
  return JSON.stringify({
    id: over.id ?? `evt_${randomUUID().replace(/-/g, '')}`, object: 'event', type: over.type ?? 'payment_intent.succeeded',
    data: { object: { id: intentId, object: 'payment_intent', amount: p.total, amount_received: over.received ?? p.total, currency: over.currency ?? 'usd', metadata: { paymentId: p.paymentId } } },
  });
}
async function post(payload: string) {
  const res = await fetch(`${base}/api/payments/webhook/stripe`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'stripe-signature': signer.webhooks.generateTestHeaderString({ payload, secret: SECRET }) },
    body: payload,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : undefined };
}
const events = (paymentId: string) => n('SELECT count(*)::int n FROM payment_events WHERE payment_id=$1', [paymentId]);

describe('webhook reference adoption (early-arrival recovery)', () => {
  it('PENDING with NULL reference -> SUCCEEDED: adopts the reference, pays the order, exactly one clearing entry', async () => {
    const p = await unreferenced(2200);
    const pi = intent();
    const payload = event(p, pi);
    const res = await post(payload);
    expect(res).toEqual({ status: 200, body: { duplicate: false } });
    expect(await row(p.paymentId)).toEqual({ status: 'SUCCEEDED', provider_reference: pi });
    expect(await orderStatus(pool, p.orderId)).toBe('PAID');
    expect(await n(clearing, [p.orderId])).toBe(1);
    expect((await post(payload)).body).toEqual({ duplicate: true });
    expect((await post(event(p, pi))).body).toEqual({ duplicate: false });
    expect(await n(clearing, [p.orderId])).toBe(1);
    expect(await row(p.paymentId)).toEqual({ status: 'SUCCEEDED', provider_reference: pi });
  });

  it('creates no earnings, settlements, payouts or refunds', async () => {
    const p = await unreferenced(800);
    await post(event(p, intent()));
    expect(await n('SELECT count(*)::int n FROM driver_earnings WHERE order_id=$1', [p.orderId])).toBe(0);
    expect(await n('SELECT count(*)::int n FROM merchant_settlements WHERE order_id=$1', [p.orderId])).toBe(0);
    expect(await n('SELECT count(*)::int n FROM refunds WHERE payment_id=$1', [p.paymentId])).toBe(0);
  });

  it('concurrent distinct events for one payment produce one clearing entry and one reference', async () => {
    const p = await unreferenced(1500);
    const pi = intent();
    const results = await Promise.all([1, 2, 3].map(() => post(event(p, pi))));
    expect(results.map((r) => r.body)).toEqual([{ duplicate: false }, { duplicate: false }, { duplicate: false }]);
    expect(await n(clearing, [p.orderId])).toBe(1);
    expect(await row(p.paymentId)).toEqual({ status: 'SUCCEEDED', provider_reference: pi });
  });

  it('rejects amount and currency mismatches and rolls everything back (reference stays NULL)', async () => {
    const p = await unreferenced(1300);
    const pi = intent();
    for (const [payload, error] of [
      [event(p, pi, { received: 1 }), 'WEBHOOK_AMOUNT_MISMATCH'],
      [event(p, pi, { currency: 'eur' }), 'WEBHOOK_CURRENCY_MISMATCH'],
    ] as const) {
      const res = await post(payload);
      expect(res.status).toBe(400);
      expect(res.body.error).toContain(error);
    }
    expect(await row(p.paymentId)).toEqual({ status: 'PENDING', provider_reference: null });
    expect(await events(p.paymentId)).toBe(0);
    expect(await n(clearing, [p.orderId])).toBe(0);
    expect(await orderStatus(pool, p.orderId)).toBe('PENDING_PAYMENT');
  });

  it('rejects a reference already attached to another payment (unique) and rolls back', async () => {
    const taken = await unreferenced(1000);
    const pi = intent();
    await post(event(taken, pi));
    const p = await unreferenced(1000);
    const res = await post(event(p, pi));
    expect(res.status).toBe(400);
    expect(await row(p.paymentId)).toEqual({ status: 'PENDING', provider_reference: null });
    expect(await events(p.paymentId)).toBe(0);
    expect(await n(clearing, [p.orderId])).toBe(0);
  });

  it('does not adopt from FAILED events or malformed intent ids', async () => {
    const p = await unreferenced(1700);
    expect((await post(event(p, intent(), { type: 'payment_intent.payment_failed', received: 0 }))).status).toBe(400);
    expect((await post(event(p, 'not_an_intent'))).status).toBe(400);
    expect(await row(p.paymentId)).toEqual({ status: 'PENDING', provider_reference: null });
    expect(await events(p.paymentId)).toBe(0);
  });

  it('never overrides an existing reference (a mismatched intent is still rejected)', async () => {
    const orderId = await insertOrder(pool, { customerId: customer.id, merchantId, totalCents: 900 });
    const paymentId = randomUUID();
    const own = intent();
    await pool.query("INSERT INTO payments(id,order_id,provider,provider_reference,amount_cents,status,idempotency_key) VALUES ($1,$2,'stripe',$3,900,'PENDING',$4)", [paymentId, orderId, own, `int-adopt-${randomUUID()}`]);
    const res = await post(event({ paymentId, total: 900 }, intent()));
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('WEBHOOK_PROVIDER_REFERENCE_MISMATCH');
    expect(await row(paymentId)).toEqual({ status: 'PENDING', provider_reference: own });
  });

  it('a same-key createPayment replay after adoption returns the paid payment without a processor call', async () => {
    const p = await unreferenced(1900);
    const pi = intent();
    await post(event(p, pi));
    // Stripe is configured with a test key that cannot reach the network; the replay must not attempt a call.
    const res = await api(base, 'POST', '/api/payments', { token: customer.token, body: { orderId: p.orderId, provider: 'stripe', amountCents: p.total, idempotencyKey: p.idempotencyKey } });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ id: p.paymentId, status: 'SUCCEEDED', provider_reference: pi });
    expect(await n(clearing, [p.orderId])).toBe(1);
  });
});
