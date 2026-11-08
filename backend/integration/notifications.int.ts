import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { offerOrderToDriver } from '../src/modules/dispatch/service.js';
import { advanceDelivery } from '../src/modules/delivery/service.js';
import { api, createDriverProfile, createMerchant, createUser, getPool, insertOrder, startApi } from './helpers.js';

let pool: Pool;
let base: string;
let close: () => Promise<void>;

beforeAll(async () => {
  pool = await getPool();
  ({ base, close } = await startApi());
});
afterAll(async () => { await close(); });

const notes = async (token: string) => (await api(base, 'GET', '/api/notifications', { token })).body as Array<Record<string, any>>;
const count = async (orderId: string) => (await pool.query('SELECT count(*)::int AS n FROM notification_events WHERE order_id=$1', [orderId])).rows[0].n as number;

describe('server-side notification creation', () => {
  it('a merchant transition notifies exactly the order customer, once, with fixed text', async () => {
    const owner = await createUser(pool, 'MERCHANT');
    const merchantId = await createMerchant(pool, owner.id);
    const customer = await createUser(pool, 'CUSTOMER');
    const stranger = await createUser(pool, 'CUSTOMER');
    const orderId = await insertOrder(pool, { customerId: customer.id, merchantId, status: 'PAID' });

    const r = await api(base, 'POST', `/api/orders/${orderId}/status`, { token: owner.token, body: { status: 'ACCEPTED' } });
    expect(r.status).toBe(200);
    const mine = (await notes(customer.token)).filter((n) => n.order_id === orderId);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ event_type: 'ORDER_STATUS', title: 'Order accepted', data: { status: 'ACCEPTED' }, read_at: null });
    expect((await notes(stranger.token)).some((n) => n.order_id === orderId)).toBe(false);
    expect((await notes(owner.token)).some((n) => n.order_id === orderId)).toBe(false);
  });

  it('a rejected transition (wrong merchant, invalid status) creates no notification', async () => {
    const owner = await createUser(pool, 'MERCHANT');
    const merchantId = await createMerchant(pool, owner.id);
    const other = await createUser(pool, 'MERCHANT');
    const customer = await createUser(pool, 'CUSTOMER');
    const orderId = await insertOrder(pool, { customerId: customer.id, merchantId, status: 'PAID' });
    expect((await api(base, 'POST', `/api/orders/${orderId}/status`, { token: other.token, body: { status: 'ACCEPTED' } })).status).toBe(403);
    expect((await api(base, 'POST', `/api/orders/${orderId}/status`, { token: owner.token, body: { status: 'READY' } })).status).toBe(409);
    expect(await count(orderId)).toBe(0);
  });

  it('dispatch notifies the customer and the assigned driver; delivery notifies the customer', async () => {
    const owner = await createUser(pool, 'MERCHANT');
    const merchantId = await createMerchant(pool, owner.id);
    const customer = await createUser(pool, 'CUSTOMER');
    const driver = await createUser(pool, 'DRIVER');
    const profileId = await createDriverProfile(pool, driver.id);
    const orderId = await insertOrder(pool, { customerId: customer.id, merchantId, status: 'READY' });

    await offerOrderToDriver(pool, orderId, profileId);
    expect((await notes(driver.token)).filter((n) => n.order_id === orderId).map((n) => n.event_type)).toEqual(['DRIVER_ASSIGNED']);
    expect((await notes(customer.token)).filter((n) => n.order_id === orderId).map((n) => n.data.status)).toEqual(['ASSIGNED']);

    await pool.query("UPDATE orders SET status='PICKED_UP' WHERE id=$1", [orderId]);
    await advanceDelivery(pool, orderId, driver.id, 'PICKED_UP');
    await advanceDelivery(pool, orderId, driver.id, 'DELIVERED');
    const statuses = (await notes(customer.token)).filter((n) => n.order_id === orderId).map((n) => n.data.status).sort();
    expect(statuses).toEqual(['ASSIGNED', 'DELIVERED', 'IN_TRANSIT']);
    await pool.query("DELETE FROM event_outbox WHERE aggregate_id=$1", [orderId]);
  });

  it('there is no HTTP endpoint to create notifications', async () => {
    const c = await createUser(pool, 'CUSTOMER');
    for (const path of ['/api/notifications', '/api/notifications/send']) {
      const r = await api(base, 'POST', path, { token: c.token, body: { userId: c.id, title: 'x', body: 'y' } });
      expect(r.status).toBe(404);
    }
  });

  it('requires authentication to list', async () => {
    expect((await api(base, 'GET', '/api/notifications')).status).toBe(401);
  });
});
