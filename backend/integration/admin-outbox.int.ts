import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { api, createUser, getPool, startApi, type TestUser } from './helpers.js';

let pool: Pool;
let base: string;
let close: () => Promise<void>;
let admin: TestUser;
let customer: TestUser;
let merchant: TestUser;
let driver: TestUser;
const created: string[] = [];
const eventType = `INT_ADMIN_${randomUUID().slice(0, 8)}`;

async function insert(status: string, lastError: string | null, type = eventType) {
  const aggregateId = randomUUID();
  const r = await pool.query(
    `INSERT INTO event_outbox (event_type,aggregate_type,aggregate_id,dedupe_key,payload,status,attempts,last_error)
     VALUES ($1,'TEST',$2,$3,'{"secret":"payload-secret-value"}'::jsonb,$4,8,$5) RETURNING id`,
    [type, aggregateId, `int-admin:${aggregateId}`, status, lastError],
  );
  created.push(r.rows[0].id);
  return { id: r.rows[0].id as string, aggregateId };
}

beforeAll(async () => {
  pool = await getPool();
  ({ base, close } = await startApi());
  [admin, customer, merchant, driver] = await Promise.all(
    (['ADMIN', 'CUSTOMER', 'MERCHANT', 'DRIVER'] as const).map((r) => createUser(pool, r)),
  );
});
afterAll(async () => {
  if (created.length) await pool.query('DELETE FROM event_outbox WHERE id = ANY($1::uuid[])', [created]);
  await close?.();
});

const path = (qs = '') => `/api/admin/outbox/blocked?eventType=${eventType}${qs}`;

describe('GET /api/admin/outbox/blocked', () => {
  it('rejects unauthenticated requests', async () => {
    expect((await api(base, 'GET', '/api/admin/outbox/blocked')).status).toBe(401);
  });

  it('rejects non-admin roles', async () => {
    for (const u of [customer, merchant, driver]) {
      expect((await api(base, 'GET', path(), { token: u.token })).status).toBe(403);
    }
  });

  it('lists only BLOCKED events, without payload, lease or dedupe data', async () => {
    const blocked = await insert('BLOCKED', 'PAYOUT_PROVIDER_CONFIRMATION_REQUIRED');
    await insert('FAILED', 'retry me');
    await insert('PENDING', null);
    const res = await api(base, 'GET', path(), { token: admin.token });
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.items).toHaveLength(1);
    const item = res.body.items[0];
    expect(item).toMatchObject({
      id: blocked.id, eventType, status: 'BLOCKED', attempts: 8, aggregateId: blocked.aggregateId,
      failureReason: 'PAYOUT_PROVIDER_CONFIRMATION_REQUIRED',
    });
    expect(item.createdAt).toBeTruthy();
    expect(JSON.stringify(res.body)).not.toContain('payload-secret-value');
    for (const key of ['payload', 'lease_token', 'leaseToken', 'dedupeKey', 'dedupe_key']) expect(item).not.toHaveProperty(key);
  });

  it('redacts secrets from the failure reason', async () => {
    const type = `${eventType}_R`;
    await insert('BLOCKED', 'provider failed sk_live_ABCDEF123 at postgres://u:p@h/db', type);
    const res = await api(base, 'GET', `/api/admin/outbox/blocked?eventType=${type}`, { token: admin.token });
    expect(res.body.items[0].failureReason).not.toMatch(/sk_live|u:p@/);
  });

  it('paginates and filters by aggregate id', async () => {
    const type = `${eventType}_P`;
    const made = [await insert('BLOCKED', 'e', type), await insert('BLOCKED', 'e', type), await insert('BLOCKED', 'e', type)];
    const q = (qs: string) => api(base, 'GET', `/api/admin/outbox/blocked?eventType=${type}${qs}`, { token: admin.token });
    const p1 = await q('&limit=2&offset=0');
    const p2 = await q('&limit=2&offset=2');
    expect(p1.body.total).toBe(3);
    expect(p1.body.items).toHaveLength(2);
    expect(p2.body.items).toHaveLength(1);
    expect(new Set([...p1.body.items, ...p2.body.items].map((i: any) => i.id)).size).toBe(3);
    const one = await q(`&aggregateId=${made[1].aggregateId}`);
    expect(one.body.items.map((i: any) => i.id)).toEqual([made[1].id]);
  });

  it('validates query parameters', async () => {
    for (const qs of ['&limit=0', '&limit=101', '&offset=-1', '&aggregateId=nope']) {
      expect((await api(base, 'GET', path(qs), { token: admin.token })).status).toBe(400);
    }
  });

  it('is read-only: other methods are not available', async () => {
    expect((await api(base, 'POST', path(), { token: admin.token, body: {} })).status).toBe(404);
    expect((await api(base, 'DELETE', path(), { token: admin.token })).status).toBe(404);
  });
});
