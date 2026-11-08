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

async function setup(status = 'ASSIGNED') {
  const owner = await createUser(pool, 'MERCHANT');
  const merchantId = await createMerchant(pool, owner.id);
  const customer = await createUser(pool, 'CUSTOMER');
  const driver = await createUser(pool, 'DRIVER');
  const driverProfileId = await createDriverProfile(pool, driver.id);
  const orderId = await insertOrder(pool, { customerId: customer.id, merchantId, status, driverProfileId });
  return { owner, merchantId, customer, driver, driverProfileId, orderId };
}
const open = (token: string, orderId: string) => api(base, 'POST', `/api/orders/${orderId}/chat`, { token });

describe('order chat threads', () => {
  it('customer, merchant owner and assigned driver all get the same single thread', async () => {
    const s = await setup();
    const a = await open(s.customer.token, s.orderId);
    const b = await open(s.owner.token, s.orderId);
    const c = await open(s.driver.token, s.orderId);
    expect([a.status, b.status, c.status]).toEqual([200, 200, 200]);
    expect(new Set([a.body.id, b.body.id, c.body.id]).size).toBe(1);
    const threads = await pool.query('SELECT count(*)::int AS n FROM chat_threads WHERE order_id=$1', [s.orderId]);
    expect(threads.rows[0].n).toBe(1);
    const parts = await pool.query('SELECT role FROM chat_participants WHERE thread_id=$1 ORDER BY role', [a.body.id]);
    expect(parts.rows.map((r) => r.role)).toEqual(['CUSTOMER', 'DRIVER', 'MERCHANT']);
  });

  it('concurrent first-opens still create exactly one thread', async () => {
    const s = await setup();
    const rs = await Promise.all([open(s.customer.token, s.orderId), open(s.owner.token, s.orderId), open(s.driver.token, s.orderId), open(s.customer.token, s.orderId)]);
    expect(new Set(rs.map((r) => r.body.id)).size).toBe(1);
    expect((await pool.query('SELECT count(*)::int AS n FROM chat_threads WHERE order_id=$1', [s.orderId])).rows[0].n).toBe(1);
  });

  it('strangers, other merchants, other drivers and admins get 404 and no thread is created', async () => {
    const s = await setup();
    const users = [await createUser(pool, 'CUSTOMER'), await createUser(pool, 'MERCHANT'), await createUser(pool, 'DRIVER'), await createUser(pool, 'ADMIN')];
    for (const u of users) expect((await open(u.token, s.orderId)).status).toBe(404);
    expect((await pool.query('SELECT 1 FROM chat_threads WHERE order_id=$1', [s.orderId])).rowCount).toBe(0);
  });

  it('requires authentication and a valid order id', async () => {
    const s = await setup();
    expect((await api(base, 'POST', `/api/orders/${s.orderId}/chat`)).status).toBe(401);
    expect((await open(s.customer.token, 'not-a-uuid')).status).toBe(400);
    expect((await open(s.customer.token, '00000000-0000-4000-8000-000000000000')).status).toBe(404);
  });

  it('refuses to create a thread for an unpaid or cancelled order (409)', async () => {
    for (const status of ['PENDING_PAYMENT', 'CANCELLED']) {
      const s = await setup(status);
      expect((await open(s.customer.token, s.orderId)).status).toBe(409);
    }
  });

  it('participants exchange messages; non-participants cannot read or send', async () => {
    const s = await setup();
    const t = (await open(s.customer.token, s.orderId)).body.id as string;
    await open(s.driver.token, s.orderId);
    expect((await api(base, 'POST', `/api/chat/${t}/messages`, { token: s.customer.token, body: { body: 'hello driver' } })).status).toBe(201);
    const read = await api(base, 'GET', `/api/chat/${t}/messages`, { token: s.driver.token });
    expect(read.body.map((m: any) => m.body)).toEqual(['hello driver']);
    const stranger = await createUser(pool, 'CUSTOMER');
    expect((await api(base, 'GET', `/api/chat/${t}/messages`, { token: stranger.token })).status).toBe(403);
    expect((await api(base, 'POST', `/api/chat/${t}/messages`, { token: stranger.token, body: { body: 'x' } })).status).toBe(403);
  });

  it('a reassigned driver is removed from the thread and loses access', async () => {
    const s = await setup();
    const t = (await open(s.customer.token, s.orderId)).body.id as string;
    await open(s.driver.token, s.orderId);
    const newDriver = await createUser(pool, 'DRIVER');
    const newProfile = await createDriverProfile(pool, newDriver.id);
    await pool.query('UPDATE orders SET driver_profile_id=$2 WHERE id=$1', [s.orderId, newProfile]);
    expect((await open(s.driver.token, s.orderId)).status).toBe(404);
    expect((await open(newDriver.token, s.orderId)).status).toBe(200);
    expect((await api(base, 'GET', `/api/chat/${t}/messages`, { token: s.driver.token })).status).toBe(403);
    expect((await api(base, 'GET', `/api/chat/${t}/messages`, { token: newDriver.token })).status).toBe(200);
  });

  it('lists only the caller\'s threads and blocks sending to a closed thread', async () => {
    const s = await setup();
    const t = (await open(s.customer.token, s.orderId)).body.id as string;
    const mine = await api(base, 'GET', '/api/chat/threads', { token: s.customer.token });
    expect(mine.body.map((x: any) => x.id)).toContain(t);
    const other = await createUser(pool, 'CUSTOMER');
    expect((await api(base, 'GET', '/api/chat/threads', { token: other.token })).body).toEqual([]);
    await pool.query('UPDATE chat_threads SET closed_at=now() WHERE id=$1', [t]);
    expect((await api(base, 'POST', `/api/chat/${t}/messages`, { token: s.customer.token, body: { body: 'late' } })).status).toBe(409);
  });
});
