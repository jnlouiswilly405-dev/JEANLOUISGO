import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { advanceDelivery } from '../src/modules/delivery/service.js';
import { blockedSettlementHandler, startOutboxRunner } from '../src/modules/settlements/outbox-runner.js';
import { createDriverProfile, createMerchant, createUser, getPool, insertOrder, type TestUser } from './helpers.js';

let pool: Pool;
let customer: TestUser;
let merchantId: string;
const createdOrders: string[] = [];

const FINANCIAL_TABLES = ['driver_earnings', 'merchant_settlements', 'payout_batches', 'ledger_entries', 'payments', 'refunds'];
const counts = async () => {
  const out: Record<string, number> = {};
  for (const t of FINANCIAL_TABLES) out[t] = (await pool.query(`SELECT count(*)::int n FROM ${t}`)).rows[0].n;
  return out;
};
const outboxRow = async (orderId: string) => (await pool.query('SELECT * FROM event_outbox WHERE aggregate_id=$1', [orderId])).rows[0];

async function deliveredOrder(): Promise<string> {
  const driver = await createUser(pool, 'DRIVER');
  const profileId = await createDriverProfile(pool, driver.id, 'BUSY');
  const orderId = await insertOrder(pool, { customerId: customer.id, merchantId, status: 'PICKED_UP', driverProfileId: profileId });
  createdOrders.push(orderId);
  await pool.query("INSERT INTO dispatch_assignments (order_id,driver_id,status) VALUES ($1,$2,'ACCEPTED')", [orderId, profileId]);
  await advanceDelivery(pool, orderId, driver.id, 'PICKED_UP');
  await advanceDelivery(pool, orderId, driver.id, 'DELIVERED');
  return orderId;
}

async function waitFor<T>(fn: () => Promise<T | undefined | false>, ms = 10000): Promise<T> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error('Timed out waiting for condition');
}

beforeAll(async () => {
  pool = await getPool();
  customer = await createUser(pool, 'CUSTOMER');
  merchantId = await createMerchant(pool, (await createUser(pool, 'MERCHANT')).id);
  // The runner claims any claimable row, so these tests need an otherwise idle outbox.
  const foreign = (await pool.query(
    `SELECT count(*)::int n FROM event_outbox
     WHERE (status IN ('PENDING','FAILED') AND available_at <= now()) OR (status='PROCESSING' AND lease_until < now())`,
  )).rows[0].n;
  if (foreign > 0) throw new Error(`Outbox has ${foreign} claimable rows; run against a clean test database`);
});
afterAll(async () => {
  if (createdOrders.length) await pool.query('DELETE FROM event_outbox WHERE aggregate_id = ANY($1::uuid[])', [createdOrders]);
});

describe('outbox runner with the fail-closed settlement handler', () => {
  it('moves a delivery settlement request to BLOCKED with PAYOUT_PROVIDER_CONFIRMATION_REQUIRED and creates no financial records', async () => {
    const orderId = await deliveredOrder();
    expect((await outboxRow(orderId)).status).toBe('PENDING');
    const before = await counts();
    const logs: string[] = [];
    const runner = startOutboxRunner({ pool, handler: blockedSettlementHandler, intervalMs: 20, maxAttempts: 1, log: (m) => logs.push(m) });
    try {
      const row = await waitFor(async () => {
        const r = await outboxRow(orderId);
        return r.status === 'BLOCKED' ? r : undefined;
      });
      expect(row.last_error).toBe('PAYOUT_PROVIDER_CONFIRMATION_REQUIRED');
      expect(row.attempts).toBe(1);
      expect(row.processed_at).toBeNull();
      expect(row.lease_token).toBeNull();
    } finally {
      await runner.stop();
    }
    expect(logs.some((l) => l.includes('PAYOUT_PROVIDER_CONFIRMATION_REQUIRED') && l.includes('[BLOCKED]'))).toBe(true);

    expect(await counts()).toEqual(before);
    for (const t of ['driver_earnings', 'merchant_settlements', 'ledger_entries']) {
      expect((await pool.query(`SELECT count(*)::int n FROM ${t} WHERE order_id=$1`, [orderId])).rows[0].n, t).toBe(0);
    }
    expect((await pool.query('SELECT status FROM orders WHERE id=$1', [orderId])).rows[0].status).toBe('DELIVERED');
  });

  it('retries with a delay before the attempt limit and never marks the event PROCESSED', async () => {
    const orderId = await deliveredOrder();
    const before = await counts();
    const runner = startOutboxRunner({ pool, handler: blockedSettlementHandler, intervalMs: 20 });
    try {
      const row = await waitFor(async () => {
        const r = await outboxRow(orderId);
        return r.status === 'FAILED' ? r : undefined;
      });
      expect(row.last_error).toBe('PAYOUT_PROVIDER_CONFIRMATION_REQUIRED');
      expect(row.attempts).toBe(1);
      expect(new Date(row.available_at).getTime()).toBeGreaterThan(Date.now());
      await new Promise((r) => setTimeout(r, 150));
      expect((await outboxRow(orderId)).attempts).toBe(1);
    } finally {
      await runner.stop();
    }
    expect((await outboxRow(orderId)).status).toBe('FAILED');
    expect(await counts()).toEqual(before);
  });

  it('does nothing when the runner is never started (disabled by default)', async () => {
    const orderId = await deliveredOrder();
    await new Promise((r) => setTimeout(r, 100));
    const row = await outboxRow(orderId);
    expect(row.status).toBe('PENDING');
    expect(row.attempts).toBe(0);
  });

  it('records a malformed event as failed without side effects', async () => {
    const orderId = await insertOrder(pool, { customerId: customer.id, merchantId, status: 'DELIVERED' });
    createdOrders.push(orderId);
    await pool.query(
      `INSERT INTO event_outbox (event_type,aggregate_type,aggregate_id,dedupe_key,payload)
       VALUES ('SETTLEMENT_REQUESTED','ORDER',$1,$2,'{"orderId":"bogus"}'::jsonb)`,
      [orderId, `int-bad-${orderId}`],
    );
    const before = await counts();
    const runner = startOutboxRunner({ pool, handler: blockedSettlementHandler, intervalMs: 20, maxAttempts: 1 });
    try {
      const row = await waitFor(async () => {
        const r = await outboxRow(orderId);
        return r.status === 'BLOCKED' ? r : undefined;
      });
      expect(row.last_error).toBe('OUTBOX_EVENT_INVALID:payload');
    } finally {
      await runner.stop();
    }
    expect(await counts()).toEqual(before);
  });
});
