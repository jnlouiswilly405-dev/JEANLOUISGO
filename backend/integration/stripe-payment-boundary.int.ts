import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import { api, createMerchant, createUser, getPool, insertOrder, orderStatus, startApi, type TestUser } from './helpers.js';

type Input = { paymentId: string; amountCents: number; currency: string; orderId: string; idempotencyKey?: string };
const fake = vi.hoisted(() => ({
  calls: [] as Input[],
  impl: null as null | ((input: Input) => Promise<{ provider: 'stripe'; providerReference: string; status: 'PENDING'; clientSecret?: string }>),
}));

// Replace only the stripe provider; the mock provider and everything else stay real.
vi.mock('../src/modules/payments/provider.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/modules/payments/provider.js')>();
  return {
    ...actual,
    getProvider: (provider: 'mock' | 'stripe') => provider === 'stripe'
      ? { verifyWebhook: () => false, createPayment: async (input: Input) => { fake.calls.push(input); return fake.impl!(input); } }
      : actual.getProvider(provider),
  };
});

let pool: Pool;
let base: string;
let close: () => Promise<void>;
let customer: TestUser;
let other: TestUser;
let merchantId: string;

beforeAll(async () => {
  pool = await getPool();
  ({ base, close } = await startApi());
  customer = await createUser(pool, 'CUSTOMER');
  other = await createUser(pool, 'CUSTOMER');
  merchantId = await createMerchant(pool, (await createUser(pool, 'MERCHANT')).id);
});
afterAll(async () => { await close?.(); });

const key = () => `int-boundary-${randomUUID()}`;
const pay = (token: string, orderId: string, amountCents: number, idempotencyKey: string) =>
  api(base, 'POST', '/api/payments', { token, body: { orderId, provider: 'stripe', amountCents, idempotencyKey } });
const intentFor = (input: Input) => `pi_fake_${input.idempotencyKey}`;
const newOrder = (total = 1000) => insertOrder(pool, { customerId: customer.id, merchantId, totalCents: total });
const paymentsFor = async (orderId: string) => (await pool.query('SELECT id,status,provider_reference FROM payments WHERE order_id=$1 ORDER BY created_at', [orderId])).rows;

/** True when another session can lock the order and payment rows right now, i.e. no transaction still holds them. */
async function rowsAreUnlocked(orderId: string): Promise<boolean> {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query('SELECT id FROM orders WHERE id=$1 FOR UPDATE NOWAIT', [orderId]);
    await c.query('SELECT id FROM payments WHERE order_id=$1 FOR UPDATE NOWAIT', [orderId]);
    return true;
  } catch (e) {
    if ((e as { code?: string }).code === '55P03') return false;
    throw e;
  } finally { await c.query('ROLLBACK'); c.release(); }
}

const reset = () => { fake.calls.length = 0; fake.impl = async (input) => ({ provider: 'stripe', providerReference: intentFor(input), status: 'PENDING', clientSecret: `${intentFor(input)}_secret` }); };

describe('stripe PaymentIntent creation is outside the database transaction', () => {
  it('commits the PENDING attempt and releases row locks before the processor call, then records the reference', async () => {
    reset();
    const orderId = await newOrder(1500);
    const seen: { rows: unknown[]; unlocked: boolean } = { rows: [], unlocked: false };
    fake.impl = async (input) => {
      seen.rows = await paymentsFor(orderId);
      seen.unlocked = await rowsAreUnlocked(orderId);
      return { provider: 'stripe', providerReference: intentFor(input), status: 'PENDING', clientSecret: 's' };
    };
    const res = await pay(customer.token, orderId, 1500, key());
    expect(res.status).toBe(201);
    expect(seen.unlocked).toBe(true);
    expect(seen.rows).toEqual([expect.objectContaining({ status: 'PENDING', provider_reference: null })]);
    expect(res.body).toMatchObject({ status: 'PENDING', order_id: orderId, clientSecret: 's' });
    const [row] = await paymentsFor(orderId);
    expect(row.provider_reference).toBe(res.body.provider_reference);
    expect(await orderStatus(pool, orderId)).toBe('PENDING_PAYMENT');
    expect((await pool.query('SELECT count(*)::int n FROM ledger_entries WHERE order_id=$1', [orderId])).rows[0].n).toBe(0);
  });

  it('definitive processor error closes the attempt as FAILED and the order can be retried with a new key', async () => {
    reset();
    const orderId = await newOrder(1200);
    fake.impl = async () => { throw Object.assign(new Error('invalid request'), { type: 'StripeInvalidRequestError' }); };
    const first = await pay(customer.token, orderId, 1200, key());
    expect(first.status).toBe(409);
    expect((await paymentsFor(orderId)).map((r) => r.status)).toEqual(['FAILED']);
    reset();
    const retry = await pay(customer.token, orderId, 1200, key());
    expect(retry.status).toBe(201);
    expect((await paymentsFor(orderId)).map((r) => r.status)).toEqual(['FAILED', 'PENDING']);
  });

  it('ambiguous processor error leaves the attempt PENDING and the same key resumes it with the same processor key', async () => {
    reset();
    const orderId = await newOrder(1300);
    const k = key();
    fake.impl = async () => { throw Object.assign(new Error('socket hang up'), { type: 'StripeConnectionError' }); };
    expect((await pay(customer.token, orderId, 1300, k)).status).toBe(409);
    expect(await paymentsFor(orderId)).toEqual([expect.objectContaining({ status: 'PENDING', provider_reference: null })]);
    // A different key must not start a second live attempt while this one is unresolved.
    const blocked = await pay(customer.token, orderId, 1300, key());
    expect(blocked.status).toBe(409);
    expect(blocked.body.error).toContain('PAYMENT_ATTEMPT_ALREADY_ACTIVE');
    reset();
    const resumed = await pay(customer.token, orderId, 1300, k);
    expect(resumed.status).toBe(201);
    expect(resumed.body.provider_reference).toBe(`pi_fake_${k}`);
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0].idempotencyKey).toBe(k);
    expect(await paymentsFor(orderId)).toHaveLength(1);
  });

  it('replaying a completed payment returns it without another processor call', async () => {
    reset();
    const orderId = await newOrder(1400);
    const k = key();
    const first = await pay(customer.token, orderId, 1400, k);
    const replay = await pay(customer.token, orderId, 1400, k);
    expect(replay.status).toBe(201);
    expect(replay.body.id).toBe(first.body.id);
    expect(replay.body.provider_reference).toBe(first.body.provider_reference);
    expect(fake.calls).toHaveLength(1);
  });

  it('concurrent requests with one key create a single payment row and one processor intent', async () => {
    reset();
    fake.impl = async (input) => { await new Promise((r) => setTimeout(r, 80)); return { provider: 'stripe', providerReference: intentFor(input), status: 'PENDING' }; };
    const orderId = await newOrder(1600);
    const k = key();
    const results = await Promise.all([1, 2, 3].map(() => pay(customer.token, orderId, 1600, k)));
    expect(results.map((r) => r.status)).toEqual([201, 201, 201]);
    expect(await paymentsFor(orderId)).toEqual([expect.objectContaining({ status: 'PENDING', provider_reference: `pi_fake_${k}` })]);
    expect(new Set(fake.calls.map((c) => c.idempotencyKey))).toEqual(new Set([k]));
  });

  it('keeps ownership and amount checks ahead of any processor call', async () => {
    reset();
    const orderId = await newOrder(1700);
    expect((await pay(other.token, orderId, 1700, key())).status).toBe(403);
    expect((await pay(customer.token, orderId, 1, key())).status).toBe(409);
    expect(fake.calls).toHaveLength(0);
    expect(await paymentsFor(orderId)).toHaveLength(0);
  });
});
