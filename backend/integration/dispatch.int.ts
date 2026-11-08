import { beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { acceptAssignment, offerOrderToDriver, rejectAssignment } from '../src/modules/dispatch/service.js';
import { createDriverProfile, createMerchant, createUser, getPool, insertOrder, orderStatus } from './helpers.js';

let pool: Pool;
let customerId: string;
let merchantId: string;

beforeAll(async () => {
  pool = await getPool();
  customerId = (await createUser(pool, 'CUSTOMER')).id;
  merchantId = await createMerchant(pool, (await createUser(pool, 'MERCHANT')).id);
});

const newDriver = async (status = 'AVAILABLE') => createDriverProfile(pool, (await createUser(pool, 'DRIVER')).id, status);
const driverStatus = async (id: string) => (await pool.query('SELECT status FROM driver_profiles WHERE id=$1', [id])).rows[0].status;

describe('dispatch offers', () => {
  it('assigns a READY order to an AVAILABLE driver and marks the driver BUSY', async () => {
    const orderId = await insertOrder(pool, { customerId, merchantId, status: 'READY' });
    const driverId = await newDriver();
    const a = await offerOrderToDriver(pool, orderId, driverId);
    expect(a.status).toBe('OFFERED');
    expect(await orderStatus(pool, orderId)).toBe('ASSIGNED');
    expect(await driverStatus(driverId)).toBe('BUSY');
  });

  it('refuses orders that are not READY and drivers that are not AVAILABLE', async () => {
    const paid = await insertOrder(pool, { customerId, merchantId, status: 'PAID' });
    await expect(offerOrderToDriver(pool, paid, await newDriver())).rejects.toThrow('ORDER_NOT_DISPATCHABLE');
    const ready = await insertOrder(pool, { customerId, merchantId, status: 'READY' });
    await expect(offerOrderToDriver(pool, ready, await newDriver('OFFLINE'))).rejects.toThrow('DRIVER_NOT_AVAILABLE');
    expect(await orderStatus(pool, ready)).toBe('READY');
  });

  it('lets exactly one of several racing drivers win the same order', async () => {
    const orderId = await insertOrder(pool, { customerId, merchantId, status: 'READY' });
    const drivers = await Promise.all([newDriver(), newDriver(), newDriver(), newDriver()]);
    const results = await Promise.allSettled(drivers.map((d) => offerOrderToDriver(pool, orderId, d)));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    for (const r of results.filter((x) => x.status === 'rejected')) {
      expect((r as PromiseRejectedResult).reason.message).toBe('ORDER_NOT_DISPATCHABLE');
    }
    const winners = (await pool.query("SELECT driver_id FROM dispatch_assignments WHERE order_id=$1", [orderId])).rows;
    expect(winners).toHaveLength(1);
    const busy = (await Promise.all(drivers.map(driverStatus))).filter((s) => s === 'BUSY');
    expect(busy).toHaveLength(1);
  });

  it('never gives one driver two orders at once', async () => {
    const driverId = await newDriver();
    const orders = await Promise.all([1, 2, 3].map(() => insertOrder(pool, { customerId, merchantId, status: 'READY' })));
    const results = await Promise.allSettled(orders.map((o) => offerOrderToDriver(pool, o, driverId)));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const assigned = (await Promise.all(orders.map((o) => orderStatus(pool, o)))).filter((s) => s === 'ASSIGNED');
    expect(assigned).toHaveLength(1);
  });
});

describe('dispatch responses', () => {
  it('lets only the offered driver accept, which moves the order to PICKED_UP', async () => {
    const orderId = await insertOrder(pool, { customerId, merchantId, status: 'READY' });
    const driverId = await newDriver();
    const intruder = await newDriver();
    const a = await offerOrderToDriver(pool, orderId, driverId);
    await expect(acceptAssignment(pool, a.id, intruder)).rejects.toThrow('ASSIGNMENT_NOT_FOUND');
    expect(await orderStatus(pool, orderId)).toBe('ASSIGNED');
    expect((await acceptAssignment(pool, a.id, driverId)).status).toBe('ACCEPTED');
    expect(await orderStatus(pool, orderId)).toBe('PICKED_UP');
    await expect(acceptAssignment(pool, a.id, driverId)).rejects.toThrow('ASSIGNMENT_NOT_OFFERED');
  });

  it('reopens the order and frees the driver when an offer is rejected', async () => {
    const orderId = await insertOrder(pool, { customerId, merchantId, status: 'READY' });
    const driverId = await newDriver();
    const a = await offerOrderToDriver(pool, orderId, driverId);
    await rejectAssignment(pool, a.id, driverId);
    expect(await orderStatus(pool, orderId)).toBe('READY');
    expect(await driverStatus(driverId)).toBe('AVAILABLE');
    const row = (await pool.query('SELECT driver_profile_id FROM orders WHERE id=$1', [orderId])).rows[0];
    expect(row.driver_profile_id).toBeNull();
  });

  it('does not let a stale rejection free a driver that has since taken another offer', async () => {
    const orderId = await insertOrder(pool, { customerId, merchantId, status: 'READY' });
    const first = await newDriver();
    const second = await newDriver();
    const a1 = await offerOrderToDriver(pool, orderId, first);
    await rejectAssignment(pool, a1.id, first);
    await offerOrderToDriver(pool, orderId, second);
    await expect(rejectAssignment(pool, a1.id, first)).rejects.toThrow('ASSIGNMENT_NOT_OFFERED');
    expect(await orderStatus(pool, orderId)).toBe('ASSIGNED');
    expect(await driverStatus(second)).toBe('BUSY');
  });
});
