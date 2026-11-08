import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { ApiError, createApiClient, merchantNextStatus, type ApiClient } from '../../packages/api-client/src/index.js';
import { createMerchant, createProduct, createUser, getPool, startApi } from './helpers.js';

// Contract tests: the shared frontend client (real fetch, real zod schemas) against the real backend on PostgreSQL.
let pool: Pool;
let base: string;
let close: () => Promise<void>;
const clientFor = (token: string | null): ApiClient => createApiClient({ baseUrl: base, getToken: () => token });

beforeAll(async () => {
  pool = await getPool();
  ({ base, close } = await startApi());
});
afterAll(async () => { await close(); });

describe('api-client contract', () => {
  it('registers, logs in and reads /me', async () => {
    const email = `fe-${randomUUID()}@example.test`;
    const anon = clientFor(null);
    const reg = await anon.auth.register({ email, displayName: 'Front End', password: 'correct-horse-1' });
    expect(reg.user.role).toBe('CUSTOMER');
    const login = await anon.auth.login(email, 'correct-horse-1');
    expect((await clientFor(login.token).auth.me()).user.email).toBe(email);
    await expect(anon.auth.login(email, 'wrong-password-1')).rejects.toMatchObject({ status: 401 });
  });

  it('customer: browse, order, pay (mock provider), list and read the order', async () => {
    const owner = await createUser(pool, 'MERCHANT');
    const merchantId = await createMerchant(pool, owner.id);
    const productId = await createProduct(pool, merchantId, 1250);
    const customer = await createUser(pool, 'CUSTOMER');
    const c = clientFor(customer.token);

    expect((await c.merchants.list()).some((m) => m.id === merchantId)).toBe(true);
    const products = await c.merchants.products(merchantId);
    expect(products.find((p) => p.id === productId)?.price_cents).toBe(1250);

    const order = await c.orders.create({ merchantId, items: [{ productId, quantity: 2 }], deliveryFeeCents: 300 });
    expect(order.status).toBe('PENDING_PAYMENT');
    expect(order.totalCents).toBe(2800);

    const payment = await c.payments.create({ orderId: order.id, provider: 'mock', amountCents: order.totalCents, idempotencyKey: randomUUID() });
    expect(payment.order_id).toBe(order.id);
    expect(payment.clientSecret).toBeUndefined();

    expect((await c.orders.list()).map((o) => o.id)).toContain(order.id);
    expect((await c.orders.get(order.id)).items[0].quantity).toBe(2);
    expect(Array.isArray(await c.notifications.list())).toBe(true);
    await c.orders.tracking(order.id);
  });

  it('merchant: sees only their orders and advances PAID -> ACCEPTED using the mapped next status', async () => {
    const owner = await createUser(pool, 'MERCHANT');
    const merchantId = await createMerchant(pool, owner.id);
    const productId = await createProduct(pool, merchantId, 900);
    const customer = await createUser(pool, 'CUSTOMER');
    const order = await clientFor(customer.token).orders.create({ merchantId, items: [{ productId, quantity: 1 }] });
    await pool.query("UPDATE orders SET status='PAID' WHERE id=$1", [order.id]);

    const m = clientFor(owner.token);
    const mine = await m.orders.list();
    expect(mine.map((o) => o.id)).toEqual([order.id]);
    const updated = await m.orders.setStatus(order.id, merchantNextStatus.PAID);
    expect(updated.status).toBe('ACCEPTED');

    const product = await m.merchants.createProduct({ merchantId, name: 'Contract item', priceCents: 450 });
    expect(product.price_cents).toBe(450);
    await expect(clientFor(customer.token).orders.setStatus(order.id, 'PREPARING')).rejects.toMatchObject({ status: 403 });
  });

  it('admin: health, summary, blocked outbox and unreferenced payments parse; non-admins get 403', async () => {
    const admin = clientFor((await createUser(pool, 'ADMIN')).token);
    expect((await admin.admin.health()).database).toBe('UP');
    expect(Array.isArray(await admin.admin.financialSummary())).toBe(true);
    const blocked = await admin.admin.blockedOutbox({ limit: 5 });
    expect(blocked.limit).toBe(5);
    const unref = await admin.admin.unreferencedPayments({ olderThanMinutes: 0, limit: 5 });
    expect(unref.olderThanMinutes).toBe(0);

    const customer = clientFor((await createUser(pool, 'CUSTOMER')).token);
    await expect(customer.admin.blockedOutbox()).rejects.toBeInstanceOf(ApiError);
    await expect(customer.admin.health()).rejects.toMatchObject({ status: 403 });
    await expect(clientFor(null).admin.health()).rejects.toMatchObject({ status: 401 });
  });
});
