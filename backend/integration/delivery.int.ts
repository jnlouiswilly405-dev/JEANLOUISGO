import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { advanceDelivery } from '../src/modules/delivery/service.js';
import { api, createDriverProfile, createMerchant, createUser, getPool, insertOrder, startApi, type TestUser } from './helpers.js';

let pool: Pool;
let base: string;
let close: () => Promise<void>;
let customer: TestUser;
let merchantId: string;
const createdOrders: string[] = [];

beforeAll(async () => {
  pool = await getPool();
  ({ base, close } = await startApi());
  customer = await createUser(pool, 'CUSTOMER');
  merchantId = await createMerchant(pool, (await createUser(pool, 'MERCHANT')).id);
});

// Outbox rows created here must not be picked up by the outbox worker tests.
afterAll(async () => {
  if (createdOrders.length) await pool.query('DELETE FROM event_outbox WHERE aggregate_id = ANY($1::uuid[])', [createdOrders]);
  await close?.();
});

/**
 * advanceDelivery() writes the driver's USER id into delivery_events.driver_id, which references
 * driver_profiles(id). Real drivers (profile id != user id) therefore hit a foreign-key violation;
 * see the KNOWN DEFECT test below. Fixtures here use profile id == user id so the rest of the
 * delivery -> outbox behaviour can still be verified.
 */
async function pickedUpOrder(opts: { distinctProfileId?: boolean } = {}) {
  const driver = await createUser(pool, 'DRIVER');
  const profileId = await createDriverProfile(pool, driver.id, 'BUSY', opts.distinctProfileId ? undefined : driver.id);
  const orderId = await insertOrder(pool, { customerId: customer.id, merchantId, status: 'PICKED_UP', driverProfileId: profileId });
  createdOrders.push(orderId);
  await pool.query("INSERT INTO dispatch_assignments (order_id,driver_id,status) VALUES ($1,$2,'ACCEPTED')", [orderId, profileId]);
  return { driver, profileId, orderId };
}
const outboxRows = async (orderId: string) => (await pool.query('SELECT * FROM event_outbox WHERE aggregate_id=$1', [orderId])).rows;

describe('delivery state machine', () => {
  it('moves PICKED_UP to IN_TRANSIT without creating a settlement request', async () => {
    const { driver, orderId } = await pickedUpOrder();
    const res = await advanceDelivery(pool, orderId, driver.id, 'PICKED_UP');
    expect(res.orderStatus).toBe('IN_TRANSIT');
    expect(await outboxRows(orderId)).toHaveLength(0);
  });

  it('delivers, frees the driver, completes the assignment and enqueues exactly one settlement request', async () => {
    const { driver, profileId, orderId } = await pickedUpOrder();
    await advanceDelivery(pool, orderId, driver.id, 'PICKED_UP');
    const res = await advanceDelivery(pool, orderId, driver.id, 'DELIVERED', { note: 'left at door' });
    expect(res.orderStatus).toBe('DELIVERED');
    const rows = await outboxRows(orderId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      event_type: 'SETTLEMENT_REQUESTED', aggregate_type: 'ORDER', status: 'PENDING', dedupe_key: `settlement-requested:${orderId}`,
    });
    expect(rows[0].payload).toMatchObject({ orderId, driverProfileId: profileId, merchantId });
    expect((await pool.query('SELECT status FROM driver_profiles WHERE id=$1', [profileId])).rows[0].status).toBe('AVAILABLE');
    expect((await pool.query('SELECT status FROM dispatch_assignments WHERE order_id=$1', [orderId])).rows[0].status).toBe('COMPLETED');
    // Settlement is only requested here; nothing is paid or ledgered.
    expect((await pool.query('SELECT count(*)::int n FROM ledger_entries WHERE order_id=$1', [orderId])).rows[0].n).toBe(0);
  });

  it('cannot deliver twice and cannot duplicate the outbox row', async () => {
    const { driver, orderId } = await pickedUpOrder();
    await advanceDelivery(pool, orderId, driver.id, 'PICKED_UP');
    await advanceDelivery(pool, orderId, driver.id, 'DELIVERED');
    await expect(advanceDelivery(pool, orderId, driver.id, 'DELIVERED')).rejects.toThrow('INVALID_DELIVERY_TRANSITION');
    expect(await outboxRows(orderId)).toHaveLength(1);
  });

  it('rejects skipping a step and rolls back completely', async () => {
    const { driver, orderId } = await pickedUpOrder();
    await expect(advanceDelivery(pool, orderId, driver.id, 'DELIVERED')).rejects.toThrow('INVALID_DELIVERY_TRANSITION');
    expect((await pool.query('SELECT status FROM orders WHERE id=$1', [orderId])).rows[0].status).toBe('PICKED_UP');
    expect(await outboxRows(orderId)).toHaveLength(0);
    expect((await pool.query('SELECT count(*)::int n FROM delivery_events WHERE order_id=$1', [orderId])).rows[0].n).toBe(0);
  });

  it('rejects a driver who is not assigned to the order', async () => {
    const { orderId } = await pickedUpOrder();
    const stranger = await createUser(pool, 'DRIVER');
    await createDriverProfile(pool, stranger.id, 'AVAILABLE');
    await expect(advanceDelivery(pool, orderId, stranger.id, 'PICKED_UP')).rejects.toThrow('ORDER_NOT_ASSIGNED_TO_DRIVER');
    const noProfile = await createUser(pool, 'DRIVER');
    await expect(advanceDelivery(pool, orderId, noProfile.id, 'PICKED_UP')).rejects.toThrow('DRIVER_PROFILE_NOT_FOUND');
  });
});

describe('known defects (documented, not fixed: source changes are out of scope)', () => {
  // it.fails passes while the defect exists and turns red once the source is fixed, prompting removal of the marker.
  it.fails('KNOWN DEFECT: a driver whose profile id differs from the user id cannot advance a delivery (delivery_events FK)', async () => {
    const { driver, orderId } = await pickedUpOrder({ distinctProfileId: true });
    const res = await advanceDelivery(pool, orderId, driver.id, 'PICKED_UP');
    expect(res.orderStatus).toBe('IN_TRANSIT');
  });
});

describe('delivery endpoint', () => {
  it('lets the assigned driver advance the order and denies customers', async () => {
    const { driver, orderId } = await pickedUpOrder();
    const body = { action: 'PICKED_UP' };
    expect((await api(base, 'POST', `/api/orders/${orderId}/delivery`, { token: customer.token, body })).status).toBe(403);
    expect((await api(base, 'POST', `/api/orders/${orderId}/delivery`, { body })).status).toBe(401);
    const ok = await api(base, 'POST', `/api/orders/${orderId}/delivery`, { token: driver.token, body });
    expect(ok.status).toBe(200);
    expect(ok.body.orderStatus).toBe('IN_TRANSIT');
  });
});
