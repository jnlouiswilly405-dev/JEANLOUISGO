import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { createDriverProfile, createMerchant, createUser, getPool, insertOrder } from './helpers.js';
import { createSettlementForDeliveredOrder, markDriverEarningsPaid, markMerchantSettlementsPaid } from '../src/modules/settlements/service.js';

// Exercises the (still unattached) settlement function directly to pin its safety properties.
// It is not reachable from any route or worker; these tests do not enable it.
let pool: Pool;
let merchantId: string;
let customerId: string;
let driverProfileId: string;

beforeAll(async () => {
  pool = await getPool();
  customerId = (await createUser(pool, 'CUSTOMER')).id;
  merchantId = await createMerchant(pool, (await createUser(pool, 'MERCHANT')).id);
  driverProfileId = await createDriverProfile(pool, (await createUser(pool, 'DRIVER')).id);
});

async function deliveredOrder(total: number, opts: { captured: boolean; paymentStatus?: string }) {
  const orderId = await insertOrder(pool, { customerId, merchantId, status: 'DELIVERED', totalCents: total, driverProfileId });
  if (opts.captured || opts.paymentStatus) {
    await pool.query(
      `INSERT INTO payments(order_id,provider,provider_reference,amount_cents,status,idempotency_key) VALUES($1,'mock',$2,$3,$4,$5)`,
      [orderId, `ref-${randomUUID()}`, total, opts.paymentStatus ?? 'SUCCEEDED', `int-settle-${randomUUID()}`],
    );
  }
  return orderId;
}
const settle = (orderId: string, total: number, fee = 100, commission = 200, bonus = 0) =>
  createSettlementForDeliveredOrder(pool, orderId, driverProfileId, merchantId, total, fee, commission, bonus);
const rowCounts = async (orderId: string) => (await pool.query(
  `SELECT (SELECT count(*)::int FROM driver_earnings WHERE order_id=$1) AS d,
          (SELECT count(*)::int FROM merchant_settlements WHERE order_id=$1) AS m,
          (SELECT count(*)::int FROM ledger_entries WHERE order_id=$1) AS l`, [orderId])).rows[0];

describe('settlement function safety (unattached; defect corrections)', () => {
  it('refuses to settle an order whose payment was not captured', async () => {
    const none = await deliveredOrder(5000, { captured: false });
    await expect(settle(none, 5000)).rejects.toThrow('PAYMENT_NOT_CAPTURED');
    const pending = await deliveredOrder(5000, { captured: false, paymentStatus: 'PENDING' });
    await expect(settle(pending, 5000)).rejects.toThrow('PAYMENT_NOT_CAPTURED');
    const failed = await deliveredOrder(5000, { captured: false, paymentStatus: 'FAILED' });
    await expect(settle(failed, 5000)).rejects.toThrow('PAYMENT_NOT_CAPTURED');
    for (const id of [none, pending, failed]) expect(await rowCounts(id)).toEqual({ d: 0, m: 0, l: 0 });
  });

  it('settles a captured delivered order once and creates no ledger entries', async () => {
    const orderId = await deliveredOrder(5000, { captured: true });
    const r = await settle(orderId, 5000);
    expect(Number(r.driverEarning.net_amount_cents)).toBe(4900);
    expect(Number(r.merchantSettlement.net_amount_cents)).toBe(4800);
    expect(await rowCounts(orderId)).toEqual({ d: 1, m: 1, l: 0 });
  });

  it('is idempotent for an identical request and returns the stored rows', async () => {
    const orderId = await deliveredOrder(3000, { captured: true });
    const first = await settle(orderId, 3000);
    const again = await settle(orderId, 3000);
    expect(again.driverEarning.id).toBe(first.driverEarning.id);
    expect(again.merchantSettlement.id).toBe(first.merchantSettlement.id);
    expect(await rowCounts(orderId)).toEqual({ d: 1, m: 1, l: 0 });
  });

  it('never overwrites an existing ELIGIBLE settlement with different amounts', async () => {
    const orderId = await deliveredOrder(4000, { captured: true });
    const first = await settle(orderId, 4000, 100, 200);
    await expect(settle(orderId, 4000, 900, 900)).rejects.toThrow('SETTLEMENT_ALREADY_EXISTS');
    const d = (await pool.query('SELECT net_amount_cents,platform_fee_cents,status FROM driver_earnings WHERE order_id=$1', [orderId])).rows[0];
    const m = (await pool.query('SELECT net_amount_cents,commission_amount_cents,status FROM merchant_settlements WHERE order_id=$1', [orderId])).rows[0];
    expect(d).toEqual({ net_amount_cents: String(first.driverEarning.net_amount_cents), platform_fee_cents: '100', status: 'ELIGIBLE' });
    expect(m).toEqual({ net_amount_cents: String(first.merchantSettlement.net_amount_cents), commission_amount_cents: '200', status: 'ELIGIBLE' });
  });

  it('concurrent identical calls produce exactly one row pair', async () => {
    const orderId = await deliveredOrder(2500, { captured: true });
    const results = await Promise.allSettled([1, 2, 3].map(() => settle(orderId, 2500)));
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    expect(await rowCounts(orderId)).toEqual({ d: 1, m: 1, l: 0 });
  });

  it('still rejects non-delivered orders, mismatched gross and invalid amounts', async () => {
    const pendingOrder = await insertOrder(pool, { customerId, merchantId, status: 'PAID', totalCents: 1000, driverProfileId });
    await expect(settle(pendingOrder, 1000)).rejects.toThrow('ORDER_NOT_DELIVERED');
    const orderId = await deliveredOrder(1000, { captured: true });
    await expect(settle(orderId, 999)).rejects.toThrow('SETTLEMENT_GROSS_DOES_NOT_MATCH_ORDER');
    await expect(settle(orderId, 1000, -1)).rejects.toThrow('INVALID_SETTLEMENT_CENTS');
  });

  it('keeps payout marking fail-closed', async () => {
    await expect(markDriverEarningsPaid(pool, [randomUUID()])).rejects.toThrow('PAYOUT_PROVIDER_CONFIRMATION_REQUIRED');
    await expect(markMerchantSettlementsPaid(pool, [randomUUID()])).rejects.toThrow('PAYOUT_PROVIDER_CONFIRMATION_REQUIRED');
  });

  it('is not referenced by any route, worker or runner (stays unattached)', () => {
    const root = join(__dirname, '..', 'src');
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (p.endsWith('.ts') && !p.endsWith('settlements/service.ts') && readFileSync(p, 'utf8').includes('createSettlementForDeliveredOrder')) offenders.push(p);
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });
});
