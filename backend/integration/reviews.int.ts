import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { api, createDriverProfile, createMerchant, createUser, getPool, insertOrder, startApi } from './helpers.js';

let pool: Pool;
let base: string;
let close: () => Promise<void>;

beforeAll(async () => {
  pool = await getPool();
  ({ base, close } = await startApi());
});
afterAll(async () => { await close(); });

async function setup(status: string) {
  const owner = await createUser(pool, 'MERCHANT');
  const merchantId = await createMerchant(pool, owner.id);
  const customer = await createUser(pool, 'CUSTOMER');
  const driver = await createUser(pool, 'DRIVER');
  const driverProfileId = await createDriverProfile(pool, driver.id);
  const orderId = await insertOrder(pool, { customerId: customer.id, merchantId, status, driverProfileId });
  return { owner, merchantId, customer, driver, orderId };
}

describe('POST /api/reviews ownership and status', () => {
  it('rejects a customer who does not own the order (403) and stores nothing', async () => {
    const s = await setup('DELIVERED');
    const stranger = await createUser(pool, 'CUSTOMER');
    const r = await api(base, 'POST', '/api/reviews', { token: stranger.token, body: { orderId: s.orderId, rating: 5 } });
    expect(r.status).toBe(403);
    expect((await pool.query('SELECT 1 FROM reviews WHERE order_id=$1', [s.orderId])).rowCount).toBe(0);
  });

  it.each(['PENDING_PAYMENT', 'PAID', 'IN_TRANSIT', 'CANCELLED'])('rejects an order in %s (409)', async (status) => {
    const s = await setup(status);
    const r = await api(base, 'POST', '/api/reviews', { token: s.customer.token, body: { orderId: s.orderId, rating: 4 } });
    expect(r.status).toBe(409);
    expect(JSON.stringify(r.body)).toContain('ORDER_NOT_DELIVERED');
  });

  it('returns 404 for an unknown order', async () => {
    const c = await createUser(pool, 'CUSTOMER');
    const r = await api(base, 'POST', '/api/reviews', { token: c.token, body: { orderId: '00000000-0000-4000-8000-000000000000', rating: 4 } });
    expect(r.status).toBe(404);
  });

  it('accepts the owner of a DELIVERED order with the order merchant and driver as subjects', async () => {
    const s = await setup('DELIVERED');
    const r = await api(base, 'POST', '/api/reviews', { token: s.customer.token, body: { orderId: s.orderId, rating: 5, merchantId: s.merchantId, subjectUserId: s.driver.id } });
    expect(r.status).toBe(201);
  });

  it('rejects another merchant or an unrelated subject user (409)', async () => {
    const s = await setup('DELIVERED');
    const otherOwner = await createUser(pool, 'MERCHANT');
    const otherMerchant = await createMerchant(pool, otherOwner.id);
    const bad1 = await api(base, 'POST', '/api/reviews', { token: s.customer.token, body: { orderId: s.orderId, rating: 5, merchantId: otherMerchant } });
    const bad2 = await api(base, 'POST', '/api/reviews', { token: s.customer.token, body: { orderId: s.orderId, rating: 5, subjectUserId: otherOwner.id } });
    expect([bad1.status, bad2.status]).toEqual([409, 409]);
  });

  it('maps a duplicate to a stable REVIEW_ALREADY_EXISTS 409 without a raw constraint message', async () => {
    const s = await setup('DELIVERED');
    const body = { orderId: s.orderId, rating: 5 };
    expect((await api(base, 'POST', '/api/reviews', { token: s.customer.token, body })).status).toBe(201);
    const dup = await api(base, 'POST', '/api/reviews', { token: s.customer.token, body });
    expect(dup.status).toBe(409);
    expect(JSON.stringify(dup.body)).toContain('REVIEW_ALREADY_EXISTS');
    expect(JSON.stringify(dup.body)).not.toContain('constraint');
  });

  it('does not let an admin review on behalf of the customer', async () => {
    const s = await setup('DELIVERED');
    const admin = await createUser(pool, 'ADMIN');
    const r = await api(base, 'POST', '/api/reviews', { token: admin.token, body: { orderId: s.orderId, rating: 5 } });
    expect(r.status).toBe(403);
  });
});
