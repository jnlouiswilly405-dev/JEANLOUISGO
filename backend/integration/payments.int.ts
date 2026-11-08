import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, createMerchant, createUser, getPool, insertOrder, orderStatus, startApi, type TestUser } from './helpers.js';

let base: string;
let close: () => Promise<void>;
let customer: TestUser;
let merchantId: string;

beforeAll(async () => {
  const pool = await getPool();
  ({ base, close } = await startApi());
  customer = await createUser(pool, 'CUSTOMER');
  const owner = await createUser(pool, 'MERCHANT');
  merchantId = await createMerchant(pool, owner.id);
});
afterAll(async () => { await close?.(); });

const key = () => `int-key-${randomUUID()}`;
const pay = (token: string, orderId: string, amountCents: number, idempotencyKey: string, provider = 'mock') =>
  api(base, 'POST', '/api/payments', { token, body: { orderId, provider, amountCents, idempotencyKey } });
const count = async (sql: string, args: unknown[]) => (await (await getPool()).query(sql, args)).rows[0].n as number;

describe('payments (mock provider, test environment only)', () => {
  it('pays an order, marks it PAID and writes exactly one clearing ledger entry', async () => {
    const pool = await getPool();
    const orderId = await insertOrder(pool, { customerId: customer.id, merchantId, totalCents: 1234 });
    const res = await pay(customer.token, orderId, 1234, key());
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('SUCCEEDED');
    expect(await orderStatus(pool, orderId)).toBe('PAID');
    expect(await count("SELECT count(*)::int n FROM ledger_entries WHERE order_id=$1 AND account_type='PLATFORM_CLEARING' AND direction='CREDIT'", [orderId])).toBe(1);
  });

  it('is idempotent: replaying the same key returns the same payment and no extra records', async () => {
    const pool = await getPool();
    const orderId = await insertOrder(pool, { customerId: customer.id, merchantId, totalCents: 500 });
    const k = key();
    const first = await pay(customer.token, orderId, 500, k);
    const second = await pay(customer.token, orderId, 500, k);
    expect(second.status).toBe(201);
    expect(second.body.id).toBe(first.body.id);
    expect(await count('SELECT count(*)::int n FROM payments WHERE order_id=$1', [orderId])).toBe(1);
    expect(await count('SELECT count(*)::int n FROM ledger_entries WHERE order_id=$1', [orderId])).toBe(1);
  });

  it('serializes concurrent requests that share an idempotency key', async () => {
    const pool = await getPool();
    const orderId = await insertOrder(pool, { customerId: customer.id, merchantId, totalCents: 700 });
    const k = key();
    const results = await Promise.all(Array.from({ length: 6 }, () => pay(customer.token, orderId, 700, k)));
    expect(new Set(results.map((r) => r.status))).toEqual(new Set([201]));
    expect(new Set(results.map((r) => r.body.id)).size).toBe(1);
    expect(await count('SELECT count(*)::int n FROM payments WHERE order_id=$1', [orderId])).toBe(1);
    expect(await count('SELECT count(*)::int n FROM ledger_entries WHERE order_id=$1', [orderId])).toBe(1);
  });

  it('rejects reuse of a key for a different request', async () => {
    const pool = await getPool();
    const orderId = await insertOrder(pool, { customerId: customer.id, merchantId, totalCents: 900 });
    const k = key();
    expect((await pay(customer.token, orderId, 900, k)).status).toBe(201);
    const res = await pay(customer.token, orderId, 901, k);
    expect(res.status).toBe(409);
    expect(res.body.error).toContain('already used');
  });

  it('rejects an amount that differs from the order total and leaves the order unpaid', async () => {
    const pool = await getPool();
    const orderId = await insertOrder(pool, { customerId: customer.id, merchantId, totalCents: 1000 });
    const res = await pay(customer.token, orderId, 1, key());
    expect(res.status).toBe(409);
    expect(await orderStatus(pool, orderId)).toBe('PENDING_PAYMENT');
    expect(await count('SELECT count(*)::int n FROM payments WHERE order_id=$1', [orderId])).toBe(0);
  });

  it('does not allow a second payment with a new key once the order is paid', async () => {
    const pool = await getPool();
    const orderId = await insertOrder(pool, { customerId: customer.id, merchantId, totalCents: 400 });
    expect((await pay(customer.token, orderId, 400, key())).status).toBe(201);
    expect((await pay(customer.token, orderId, 400, key())).status).toBe(409);
    expect(await count('SELECT count(*)::int n FROM payments WHERE order_id=$1', [orderId])).toBe(1);
  });
});

describe('payment ownership', () => {
  it('forbids a customer from paying another customer\'s order and writes nothing', async () => {
    const pool = await getPool();
    const stranger = await createUser(pool, 'CUSTOMER');
    const orderId = await insertOrder(pool, { customerId: customer.id, merchantId, totalCents: 1100 });
    const res = await pay(stranger.token, orderId, 1100, key());
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('ORDER_FORBIDDEN');
    expect(await orderStatus(pool, orderId)).toBe('PENDING_PAYMENT');
    expect(await count('SELECT count(*)::int n FROM payments WHERE order_id=$1', [orderId])).toBe(0);
    expect(await count('SELECT count(*)::int n FROM ledger_entries WHERE order_id=$1', [orderId])).toBe(0);
  });

  it('does not let another customer replay the owner\'s idempotency key to read the payment', async () => {
    const pool = await getPool();
    const stranger = await createUser(pool, 'CUSTOMER');
    const orderId = await insertOrder(pool, { customerId: customer.id, merchantId, totalCents: 1200 });
    const k = key();
    expect((await pay(customer.token, orderId, 1200, k)).status).toBe(201);
    const res = await pay(stranger.token, orderId, 1200, k);
    expect(res.status).toBe(403);
    expect(res.body.id).toBeUndefined();
  });

  it('still lets the owner and admins pay', async () => {
    const pool = await getPool();
    const admin = await createUser(pool, 'ADMIN');
    const orderId = await insertOrder(pool, { customerId: customer.id, merchantId, totalCents: 1300 });
    expect((await pay(admin.token, orderId, 1300, key())).status).toBe(201);
    expect(await orderStatus(pool, orderId)).toBe('PAID');
  });
});

describe('live payment safety', () => {
  it('keeps the stripe provider disabled and writes nothing', async () => {
    const pool = await getPool();
    const orderId = await insertOrder(pool, { customerId: customer.id, merchantId, totalCents: 800 });
    const res = await pay(customer.token, orderId, 800, key(), 'stripe');
    expect(res.status).toBe(409);
    expect(res.body.error).toContain('PAYMENT_PROVIDER_NOT_IMPLEMENTED');
    expect(await orderStatus(pool, orderId)).toBe('PENDING_PAYMENT');
    expect(await count('SELECT count(*)::int n FROM payments WHERE order_id=$1', [orderId])).toBe(0);
    expect(await count("SELECT count(*)::int n FROM ledger_entries WHERE order_id=$1", [orderId])).toBe(0);
  });

  it('rejects stripe webhooks and records no event', async () => {
    const pool = await getPool();
    const orderId = await insertOrder(pool, { customerId: customer.id, merchantId, totalCents: 600 });
    const eventId = `evt_${randomUUID()}`;
    const res = await api(base, 'POST', '/api/payments/webhook/stripe', {
      body: { eventId, type: 'PAYMENT_SUCCEEDED', paymentId: randomUUID(), status: 'SUCCEEDED', amountCents: 600, currency: 'USD', providerReference: 'x', rawBody: '{}', signature: 'sig' },
    });
    expect(res.status).toBe(400);
    expect(await count('SELECT count(*)::int n FROM payment_events WHERE event_id=$1', [eventId])).toBe(0);
    expect(await orderStatus(pool, orderId)).toBe('PENDING_PAYMENT');
  });

  it('keeps refunds disabled', async () => {
    const admin = await createUser(await getPool(), 'ADMIN');
    const res = await api(base, 'POST', `/api/payments/${randomUUID()}/refund`, { token: admin.token, body: { amountCents: 100 } });
    expect(res.status).toBe(409);
    expect(res.body.error).toContain('REFUND_PROVIDER_NOT_IMPLEMENTED');
  });
});

describe('payment webhooks (mock provider)', () => {
  async function paidPayment(total: number) {
    const pool = await getPool();
    const orderId = await insertOrder(pool, { customerId: customer.id, merchantId, totalCents: total });
    const res = await pay(customer.token, orderId, total, key());
    const ref = (await pool.query('SELECT provider_reference FROM payments WHERE id=$1', [res.body.id])).rows[0].provider_reference;
    return { orderId, paymentId: res.body.id as string, providerReference: ref as string };
  }
  const hook = (p: { paymentId: string; providerReference: string }, eventId: string, amountCents: number) =>
    api(base, 'POST', '/api/payments/webhook/mock', {
      body: { eventId, type: 'PAYMENT_SUCCEEDED', paymentId: p.paymentId, status: 'SUCCEEDED', amountCents, currency: 'USD', providerReference: p.providerReference, rawBody: '{}', signature: 'sig' },
    });

  it('processes an event once and reports replays as duplicates without a second ledger entry', async () => {
    const p = await paidPayment(1500);
    const eventId = `evt_${randomUUID()}`;
    expect((await hook(p, eventId, 1500)).body).toEqual({ duplicate: false });
    expect((await hook(p, eventId, 1500)).body).toEqual({ duplicate: true });
    expect(await count("SELECT count(*)::int n FROM ledger_entries WHERE order_id=$1 AND account_type='PLATFORM_CLEARING'", [p.orderId])).toBe(1);
  });

  it('rejects a mismatching amount and rolls the event record back', async () => {
    const p = await paidPayment(1600);
    const eventId = `evt_${randomUUID()}`;
    const res = await hook(p, eventId, 1);
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('WEBHOOK_AMOUNT_MISMATCH');
    expect(await count('SELECT count(*)::int n FROM payment_events WHERE event_id=$1', [eventId])).toBe(0);
  });
});
