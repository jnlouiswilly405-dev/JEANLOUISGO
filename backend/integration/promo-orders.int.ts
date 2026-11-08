import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { api, createMerchant, createProduct, createUser, getPool, startApi } from './helpers.js';

let pool: Pool;
let base: string;
let close: () => Promise<void>;
let merchantId: string;
let productId: string; // 2000 cents

beforeAll(async () => {
  pool = await getPool();
  ({ base, close } = await startApi());
  merchantId = await createMerchant(pool, (await createUser(pool, 'MERCHANT')).id);
  productId = await createProduct(pool, merchantId, 2000);
});
afterAll(async () => { await close(); });

const newCode = () => `PR${randomUUID().slice(0, 8).toUpperCase()}`;
async function promo(o: { type?: string; value?: number; max?: number | null; min?: number; limit?: number | null; active?: boolean; expired?: boolean } = {}) {
  const code = newCode();
  const r = await pool.query(
    `INSERT INTO promo_codes (code,discount_type,discount_value,max_discount,min_order_total,usage_limit,active,expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [code, o.type ?? 'PERCENT', o.value ?? 10, o.max ?? null, o.min ?? 0, o.limit ?? null, o.active ?? true, o.expired ? new Date(Date.now() - 60_000) : null],
  );
  return { code, id: r.rows[0].id as string };
}
const place = (token: string, promoCode?: string, extra: Record<string, unknown> = {}) =>
  api(base, 'POST', '/api/orders', { token, body: { merchantId, items: [{ productId, quantity: 1 }], deliveryFeeCents: 300, ...(promoCode ? { promoCode } : {}), ...extra } });
const used = async (id: string) => (await pool.query('SELECT used_count FROM promo_codes WHERE id=$1', [id])).rows[0].used_count as number;
const redemptions = async (id: string) => (await pool.query('SELECT count(*)::int AS n FROM promo_redemptions WHERE promo_id=$1', [id])).rows[0].n as number;
const orderCount = async (customerId: string) => (await pool.query('SELECT count(*)::int AS n FROM orders WHERE customer_id=$1', [customerId])).rows[0].n as number;

describe('promo codes in order creation', () => {
  it('orders without a promo are unchanged (discountCents 0)', async () => {
    const c = await createUser(pool, 'CUSTOMER');
    const r = await place(c.token);
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ subtotalCents: 2000, deliveryFeeCents: 300, totalCents: 2300, discountCents: 0 });
  });

  it('applies a percent discount to the subtotal only, records one redemption and charges the discounted total', async () => {
    const p = await promo({ value: 10 });
    const c = await createUser(pool, 'CUSTOMER');
    const r = await place(c.token, p.code.toLowerCase());
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ subtotalCents: 2000, deliveryFeeCents: 300, discountCents: 200, totalCents: 2100 });
    expect(await used(p.id)).toBe(1);
    const red = await pool.query('SELECT discount_amount, order_id, user_id FROM promo_redemptions WHERE promo_id=$1', [p.id]);
    expect(red.rows).toHaveLength(1);
    expect(red.rows[0]).toMatchObject({ discount_amount: '2.00', order_id: r.body.id, user_id: c.id });
    const stored = await pool.query('SELECT total_cents FROM orders WHERE id=$1', [r.body.id]);
    expect(stored.rows[0].total_cents).toBe(2100);
    // The payment API requires the exact discounted total, so the customer cannot pay the undiscounted or a lower amount.
    const wrong = await api(base, 'POST', '/api/payments', { token: c.token, body: { orderId: r.body.id, provider: 'mock', amountCents: 2300, idempotencyKey: randomUUID() } });
    expect(wrong.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(wrong.body)).toContain('does not match');
    const right = await api(base, 'POST', '/api/payments', { token: c.token, body: { orderId: r.body.id, provider: 'mock', amountCents: 2100, idempotencyKey: randomUUID() } });
    expect(right.status).toBe(201);
  });

  it('honours a fixed discount and max_discount and never exceeds the subtotal', async () => {
    const c = await createUser(pool, 'CUSTOMER');
    const capped = await promo({ value: 50, max: 3 });
    expect((await place(c.token, capped.code)).body.discountCents).toBe(300);
    const c2 = await createUser(pool, 'CUSTOMER');
    const fixed = await promo({ type: 'FIXED', value: 5 });
    expect((await place(c2.token, fixed.code)).body.discountCents).toBe(500);
  });

  it('rejects unknown, inactive, expired, below-minimum codes with 400 and creates no order', async () => {
    const c = await createUser(pool, 'CUSTOMER');
    const inactive = await promo({ active: false });
    const expired = await promo({ expired: true });
    const minHigh = await promo({ min: 50 });
    for (const code of ['NOPE-NOPE', inactive.code, expired.code, minHigh.code]) {
      const r = await place(c.token, code);
      expect(r.status).toBe(400);
      expect(JSON.stringify(r.body)).toContain('PROMO_INVALID');
    }
    expect(await orderCount(c.id)).toBe(0);
  });

  it('allows one use per customer and rolls the second order back', async () => {
    const p = await promo();
    const c = await createUser(pool, 'CUSTOMER');
    expect((await place(c.token, p.code)).status).toBe(201);
    const again = await place(c.token, p.code);
    expect(again.status).toBe(400);
    expect(JSON.stringify(again.body)).toContain('PROMO_ALREADY_USED');
    expect(await orderCount(c.id)).toBe(1);
    expect(await used(p.id)).toBe(1);
  });

  it('enforces usage_limit under concurrency: exactly one of several customers wins', async () => {
    const p = await promo({ limit: 1 });
    const users = await Promise.all([1, 2, 3, 4, 5].map(() => createUser(pool, 'CUSTOMER')));
    const rs = await Promise.all(users.map((u) => place(u.token, p.code)));
    expect(rs.filter((r) => r.status === 201)).toHaveLength(1);
    expect(rs.filter((r) => r.status === 400)).toHaveLength(4);
    expect(await used(p.id)).toBe(1);
    expect(await redemptions(p.id)).toBe(1);
  });

  it('refuses a promo that would make the total zero and leaves no trace', async () => {
    const p = await promo({ value: 100 });
    const c = await createUser(pool, 'CUSTOMER');
    const r = await api(base, 'POST', '/api/orders', { token: c.token, body: { merchantId, items: [{ productId, quantity: 1 }], promoCode: p.code } });
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.body)).toContain('PROMO_NOT_APPLICABLE');
    expect(await orderCount(c.id)).toBe(0);
    expect(await used(p.id)).toBe(0);
    expect(await redemptions(p.id)).toBe(0);
  });

  it('ignores any client-supplied discount or total fields', async () => {
    const c = await createUser(pool, 'CUSTOMER');
    const r = await place(c.token, undefined, { discountCents: 2000, totalCents: 1 });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ totalCents: 2300, discountCents: 0 });
  });

  it('gives the promo use back when the order is cancelled, so it can be used again', async () => {
    const p = await promo({ limit: 1 });
    const c = await createUser(pool, 'CUSTOMER');
    const admin = await createUser(pool, 'ADMIN');
    const first = await place(c.token, p.code);
    expect(first.status).toBe(201);
    expect((await api(base, 'POST', `/api/orders/${first.body.id}/status`, { token: admin.token, body: { status: 'CANCELLED' } })).status).toBe(200);
    expect(await used(p.id)).toBe(0);
    expect(await redemptions(p.id)).toBe(0);
    expect((await place(c.token, p.code)).status).toBe(201);
    expect(await used(p.id)).toBe(1);
  });

  it('requires authentication', async () => {
    const r = await api(base, 'POST', '/api/orders', { body: { merchantId, items: [{ productId, quantity: 1 }], promoCode: 'X' } });
    expect(r.status).toBe(401);
  });
});
