import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { api, createMerchant, createUser, getPool, insertOrder, startApi, type TestUser } from './helpers.js';

let pool: Pool;
let base: string;
let close: () => Promise<void>;
let admin: TestUser;
let customer: TestUser;
let merchant: TestUser;
let driver: TestUser;
let merchantId: string;

const stuck = { old: '', recent: '', referenced: '', mock: '', failed: '' };
const orders: string[] = [];

async function insertPayment(opts: { provider: string; status: string; reference: string | null; ageMinutes: number }) {
  const orderId = await insertOrder(pool, { customerId: customer.id, merchantId, totalCents: 1234 });
  orders.push(orderId);
  const r = await pool.query(
    `INSERT INTO payments(order_id,provider,provider_reference,amount_cents,status,idempotency_key,created_at)
     VALUES($1,$2,$3,1234,$4,$5, now() - make_interval(mins => $6)) RETURNING id`,
    [orderId, opts.provider, opts.reference, opts.status, `int-recon-${randomUUID()}`, opts.ageMinutes],
  );
  return r.rows[0].id as string;
}

beforeAll(async () => {
  pool = await getPool();
  ({ base, close } = await startApi());
  [admin, customer, merchant, driver] = await Promise.all(
    (['ADMIN', 'CUSTOMER', 'MERCHANT', 'DRIVER'] as const).map((r) => createUser(pool, r)),
  );
  merchantId = await createMerchant(pool, merchant.id);
  stuck.old = await insertPayment({ provider: 'stripe', status: 'PENDING', reference: null, ageMinutes: 120 });
  stuck.recent = await insertPayment({ provider: 'stripe', status: 'PENDING', reference: null, ageMinutes: 1 });
  stuck.referenced = await insertPayment({ provider: 'stripe', status: 'PENDING', reference: `pi_ref_${randomUUID()}`, ageMinutes: 120 });
  stuck.mock = await insertPayment({ provider: 'mock', status: 'PENDING', reference: null, ageMinutes: 120 });
  stuck.failed = await insertPayment({ provider: 'stripe', status: 'FAILED', reference: null, ageMinutes: 120 });
});
afterAll(async () => { await close?.(); });

const url = (qs = '') => `/api/admin/payments/unreferenced${qs}`;
const ids = (body: { items: { paymentId: string }[] }) => body.items.map((i) => i.paymentId);
const counts = async () => (await pool.query(
  `SELECT (SELECT count(*)::int FROM ledger_entries) AS ledger,
          (SELECT count(*)::int FROM payments WHERE status='SUCCEEDED') AS succeeded,
          (SELECT count(*)::int FROM payments) AS payments,
          (SELECT count(*)::int FROM orders WHERE status='PAID') AS paid`,
)).rows[0];

describe('GET /api/admin/payments/unreferenced', () => {
  it('rejects unauthenticated requests', async () => {
    expect((await api(base, 'GET', url())).status).toBe(401);
  });

  it('rejects non-admin roles', async () => {
    for (const u of [customer, merchant, driver]) expect((await api(base, 'GET', url(), { token: u.token })).status).toBe(403);
  });

  it('lists only old, unreferenced, PENDING stripe payments for admins', async () => {
    const res = await api(base, 'GET', url('?olderThanMinutes=60&limit=100'), { token: admin.token });
    expect(res.status).toBe(200);
    const found = ids(res.body);
    expect(found).toContain(stuck.old);
    for (const excluded of [stuck.recent, stuck.referenced, stuck.mock, stuck.failed]) expect(found).not.toContain(excluded);
    const item = res.body.items.find((i: { paymentId: string }) => i.paymentId === stuck.old);
    expect(item).toMatchObject({ amountCents: 1234, currency: 'USD' });
    expect(item.ageMinutes).toBeGreaterThanOrEqual(119);
  });

  it('applies the default 15 minute threshold and a configurable one', async () => {
    const def = await api(base, 'GET', url('?limit=100'), { token: admin.token });
    expect(def.body.olderThanMinutes).toBe(15);
    expect(ids(def.body)).toContain(stuck.old);
    expect(ids(def.body)).not.toContain(stuck.recent);
    const zero = await api(base, 'GET', url('?olderThanMinutes=0&limit=100'), { token: admin.token });
    expect(ids(zero.body)).toContain(stuck.recent);
  });

  it('paginates and validates input', async () => {
    const p1 = await api(base, 'GET', url('?olderThanMinutes=0&limit=1&offset=0'), { token: admin.token });
    const p2 = await api(base, 'GET', url('?olderThanMinutes=0&limit=1&offset=1'), { token: admin.token });
    expect(p1.body.items).toHaveLength(1);
    expect(p2.body.items).toHaveLength(1);
    expect(p1.body.items[0].paymentId).not.toBe(p2.body.items[0].paymentId);
    expect(p1.body.total).toBeGreaterThanOrEqual(2);
    expect((await api(base, 'GET', url('?limit=0'), { token: admin.token })).status).toBe(400);
    expect((await api(base, 'GET', url('?limit=101'), { token: admin.token })).status).toBe(400);
    expect((await api(base, 'GET', url('?olderThanMinutes=-1'), { token: admin.token })).status).toBe(400);
  });

  it('exposes no secrets or idempotency keys and writes nothing', async () => {
    const before = await counts();
    const res = await api(base, 'GET', url('?olderThanMinutes=0&limit=100'), { token: admin.token });
    expect(res.status).toBe(200);
    const text = JSON.stringify(res.body);
    expect(text).not.toMatch(/idempotency|int-recon-|clientSecret|sk_|whsec_/i);
    expect(Object.keys(res.body.items[0]).sort()).toEqual(['ageMinutes', 'amountCents', 'createdAt', 'currency', 'orderId', 'paymentId']);
    expect(await counts()).toEqual(before);
    const status = (await pool.query('SELECT status FROM payments WHERE id=$1', [stuck.old])).rows[0].status;
    expect(status).toBe('PENDING');
  });
});
