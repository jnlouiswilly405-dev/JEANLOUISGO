import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { api, createMerchant, createProduct, createUser, getPool, insertOrder, startApi } from './helpers.js';

let pool: Pool;
let base: string;
let close: () => Promise<void>;

beforeAll(async () => { pool = await getPool(); ({ base, close } = await startApi()); });
afterAll(async () => { await close(); });

const code = () => `AD${randomUUID().slice(0, 8).toUpperCase()}`;
const deliveryAddress = { line1: '1 Test Street', city: 'Spring Valley', stateCode: 'NY', postalCode: '10977' };

describe('admin promo management', () => {
  it('rejects unauthenticated and non-admin callers', async () => {
    const c = await createUser(pool, 'CUSTOMER');
    expect((await api(base, 'GET', '/api/admin/promos')).status).toBe(401);
    expect((await api(base, 'GET', '/api/admin/promos', { token: c.token })).status).toBe(403);
    expect((await api(base, 'POST', '/api/admin/promos', { token: c.token, body: { code: code(), discountType: 'PERCENT', percent: 10 } })).status).toBe(403);
  });

  it('creates, lists, deactivates, audits, and the promo works in order creation', async () => {
    const admin = await createUser(pool, 'ADMIN');
    const cust = await createUser(pool, 'CUSTOMER');
    const merchantId = await createMerchant(pool, (await createUser(pool, 'MERCHANT')).id);
    const productId = await createProduct(pool, merchantId, 2000);
    const c = code().toLowerCase();
    const created = await api(base, 'POST', '/api/admin/promos', { token: admin.token, body: { code: c, discountType: 'PERCENT', percent: 10, usageLimit: 5 } });
    expect(created.status).toBe(201);
    expect(created.body.code).toBe(c.toUpperCase());
    expect(created.body.percent).toBe(10);
    expect(created.body.active).toBe(true);

    const list = await api(base, 'GET', '/api/admin/promos?limit=100', { token: admin.token });
    expect(list.status).toBe(200);
    expect(list.body.items.some((p: { id: string }) => p.id === created.body.id)).toBe(true);

    const order = await api(base, 'POST', '/api/orders', { token: cust.token, body: { merchantId, items: [{ productId, quantity: 1 }], deliveryAddress, deliveryFeeCents: 300, promoCode: c.toUpperCase() } });
    expect(order.status).toBe(201);
    expect(order.body.discountCents).toBe(200);

    const off = await api(base, 'POST', `/api/admin/promos/${created.body.id}/active`, { token: admin.token, body: { active: false } });
    expect(off.status).toBe(200);
    expect(off.body.active).toBe(false);
    const cust2 = await createUser(pool, 'CUSTOMER');
    const rejected = await api(base, 'POST', '/api/orders', { token: cust2.token, body: { merchantId, items: [{ productId, quantity: 1 }], deliveryAddress, deliveryFeeCents: 300, promoCode: c } });
    expect(rejected.status).toBeGreaterThanOrEqual(400);

    const audit = await pool.query(`SELECT action FROM audit_events WHERE entity_type='PROMO' AND entity_id=$1 ORDER BY created_at`, [created.body.id]);
    expect(audit.rows.map((r) => r.action)).toEqual(['PROMO_CREATED', 'PROMO_DEACTIVATED']);
  });

  it('validates input and rejects duplicates and unknown ids', async () => {
    const admin = await createUser(pool, 'ADMIN');
    const post = (body: unknown) => api(base, 'POST', '/api/admin/promos', { token: admin.token, body });
    expect((await post({ code: 'x', discountType: 'PERCENT', percent: 10 })).status).toBe(400);
    expect((await post({ code: code(), discountType: 'PERCENT', percent: 150 })).status).toBe(400);
    expect((await post({ code: code(), discountType: 'PERCENT' })).status).toBe(400);
    expect((await post({ code: code(), discountType: 'FIXED' })).status).toBe(400);
    expect((await post({ code: code(), discountType: 'FIXED', amountCents: -5 })).status).toBe(400);
    expect((await post({ code: code(), discountType: 'FIXED', amountCents: 100, extra: 1 })).status).toBe(400);
    expect((await post({ code: code(), discountType: 'FIXED', amountCents: 100, startsAt: '2030-01-02T00:00:00Z', expiresAt: '2030-01-01T00:00:00Z' })).body.error).toBe('PROMO_DATES_INVALID');
    const c = code();
    expect((await post({ code: c, discountType: 'FIXED', amountCents: 250 })).status).toBe(201);
    const dup = await post({ code: c.toLowerCase(), discountType: 'FIXED', amountCents: 250 });
    expect(dup.status).toBe(409);
    expect(dup.body.error).toBe('PROMO_CODE_EXISTS');
    expect((await api(base, 'POST', `/api/admin/promos/${randomUUID()}/active`, { token: admin.token, body: { active: false } })).status).toBe(404);
  });
});

describe('merchant review listing', () => {
  it('requires auth and returns only public fields with an average', async () => {
    const owner = await createUser(pool, 'MERCHANT');
    const merchantId = await createMerchant(pool, owner.id);
    const cust = await createUser(pool, 'CUSTOMER');
    expect((await api(base, 'GET', `/api/merchants/${merchantId}/reviews`)).status).toBe(401);
    expect((await api(base, 'GET', '/api/merchants/not-a-uuid/reviews', { token: cust.token })).status).toBe(400);

    const empty = await api(base, 'GET', `/api/merchants/${merchantId}/reviews`, { token: cust.token });
    expect(empty.body).toMatchObject({ average: null, count: 0, items: [] });

    for (const rating of [5, 4]) {
      const c = await createUser(pool, 'CUSTOMER');
      const o = await insertOrder(pool, { customerId: c.id, merchantId, status: 'DELIVERED', totalCents: 1000 });
      const r = await api(base, 'POST', '/api/reviews', { token: c.token, body: { orderId: o, merchantId, rating, body: `r${rating}` } });
      expect(r.status).toBe(201);
    }
    const res = await api(base, 'GET', `/api/merchants/${merchantId}/reviews?limit=1`, { token: cust.token });
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(2);
    expect(res.body.average).toBe(4.5);
    expect(res.body.items).toHaveLength(1);
    expect(Object.keys(res.body.items[0]).sort()).toEqual(['body', 'createdAt', 'id', 'rating']);
  });
});
