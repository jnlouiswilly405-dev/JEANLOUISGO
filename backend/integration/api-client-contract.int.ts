import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { ApiError, createApiClient, merchantNextStatus, type ApiClient } from '../../packages/api-client/src/index.js';
import { createDriverProfile, createMerchant, createProduct, createUser, getPool, insertOrder, orderStatus, startApi } from './helpers.js';

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
    expect(await c.orders.tracking(order.id)).toEqual([]);
    const driverProfileId = await createDriverProfile(pool, (await createUser(pool, 'DRIVER')).id);
    await pool.query('INSERT INTO driver_location_events(driver_id,order_id,lat,lng) VALUES($1,$2,40.7128,-74.006)', [driverProfileId, order.id]);
    const [point] = await c.orders.tracking(order.id);
    expect(point.lat).toBeCloseTo(40.7128, 4);
    expect(point.lng).toBeCloseTo(-74.006, 4);
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
    const created = await clientFor((await createUser(pool, 'MERCHANT')).token).merchants.create(`Contract Kitchen ${randomUUID().slice(0, 8)}`);
    expect(created.active).toBe(true);
    await expect(clientFor(customer.token).orders.setStatus(order.id, 'PREPARING')).rejects.toMatchObject({ status: 403 });
  });

  it('driver: sees assigned orders and completes pickup -> in transit -> delivered with location updates', async () => {
    const owner = await createUser(pool, 'MERCHANT');
    const merchantId = await createMerchant(pool, owner.id);
    const customer = await createUser(pool, 'CUSTOMER');
    const driver = await createUser(pool, 'DRIVER');
    const profileId = await createDriverProfile(pool, driver.id);
    const orderId = await insertOrder(pool, { customerId: customer.id, merchantId, status: 'ASSIGNED', driverProfileId: profileId });

    const d = clientFor(driver.token);
    const [mine] = await d.orders.list();
    expect(mine.id).toBe(orderId);
    expect(mine.driverId).toBe(profileId); // the profile id the app needs for location updates

    await d.drivers.sendLocation(profileId, { lat: 40.7, lng: -74, orderId, accuracyM: 5 });
    expect((await d.orders.setStatus(orderId, 'PICKED_UP')).status).toBe('PICKED_UP');
    await d.orders.advanceDelivery(orderId, 'PICKED_UP');
    expect(await orderStatus(pool, orderId)).toBe('IN_TRANSIT');
    await expect(d.orders.advanceDelivery(orderId, 'PICKED_UP')).rejects.toMatchObject({ status: 409 });
    await d.orders.advanceDelivery(orderId, 'DELIVERED');
    // Delivery enqueues a SETTLEMENT_REQUESTED outbox row; remove it so the outbox suites see a clean table.
    await pool.query('DELETE FROM event_outbox WHERE aggregate_id=$1', [orderId]);
    expect(await orderStatus(pool, orderId)).toBe('DELIVERED');
    expect((await clientFor(customer.token).orders.tracking(orderId)).length).toBe(1);

    const otherDriver = clientFor((await createUser(pool, 'DRIVER')).token);
    await expect(otherDriver.orders.advanceDelivery(orderId, 'DELIVERED')).rejects.toBeInstanceOf(ApiError);
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

describe('api-client contract: notifications, reviews, promos, chat, read-only finance', () => {
  it('notifications: lists own rows, marks read, cannot mark someone else\'s', async () => {
    const me = await createUser(pool, 'CUSTOMER');
    const other = await createUser(pool, 'CUSTOMER');
    const ins = await pool.query(
      `INSERT INTO notification_events (user_id,event_type,title,body,data) VALUES ($1,'ORDER_UPDATE','Order update','Your order moved',$2) RETURNING id`,
      [me.id, JSON.stringify({ k: 'v' })],
    );
    const id = ins.rows[0].id as string;
    const list = await clientFor(me.token).notifications.list();
    expect(list.map((n) => n.id)).toContain(id);
    expect(list.find((n) => n.id === id)?.read_at).toBeNull();
    expect((await clientFor(me.token).notifications.markRead(id)).read_at).not.toBeNull();
    expect((await clientFor(other.token).notifications.list()).some((n) => n.id === id)).toBe(false);
    await expect(clientFor(other.token).notifications.markRead(id)).rejects.toMatchObject({ status: 404 });
  });

  it('reviews: customer reviews a delivered order once; the duplicate is a 409', async () => {
    const owner = await createUser(pool, 'MERCHANT');
    const merchantId = await createMerchant(pool, owner.id);
    const customer = await createUser(pool, 'CUSTOMER');
    const orderId = await insertOrder(pool, { customerId: customer.id, merchantId, status: 'DELIVERED' });
    const c = clientFor(customer.token);
    const row = await c.reviews.create({ orderId, rating: 5, body: 'Great', merchantId });
    expect(row).toMatchObject({ rating: 5, merchant_id: merchantId });
    await expect(c.reviews.create({ orderId, rating: 4, merchantId })).rejects.toMatchObject({ status: 409 });
    await expect(c.reviews.create({ orderId, rating: 9 })).rejects.toMatchObject({ status: 400 });
    await expect(clientFor((await createUser(pool, 'DRIVER')).token).reviews.create({ orderId, rating: 3 })).rejects.toMatchObject({ status: 403 });
  });

  it('promos: validate previews a discount in major units and never redeems', async () => {
    const code = `FE${randomUUID().slice(0, 8).toUpperCase()}`;
    const promo = await pool.query(
      `INSERT INTO promo_codes (code,discount_type,discount_value,min_order_total) VALUES ($1,'PERCENT',10,5) RETURNING id`, [code],
    );
    const c = clientFor((await createUser(pool, 'CUSTOMER')).token);
    const preview = await c.promos.validate(code.toLowerCase(), 20);
    expect(preview).toMatchObject({ code, discount: 2 });
    await expect(c.promos.validate(code, 1)).rejects.toMatchObject({ status: 409 });
    await expect(c.promos.validate('NOPE', 20)).rejects.toMatchObject({ status: 409 });
    const used = await pool.query('SELECT used_count FROM promo_codes WHERE id=$1', [promo.rows[0].id]);
    expect(used.rows[0].used_count).toBe(0);
    const red = await pool.query('SELECT count(*)::int AS n FROM promo_redemptions WHERE promo_id=$1', [promo.rows[0].id]);
    expect(red.rows[0].n).toBe(0);
  });

  it('chat: the client opens the order thread, exchanges messages and outsiders are refused', async () => {
    const owner = await createUser(pool, 'MERCHANT');
    const merchantId = await createMerchant(pool, owner.id);
    const customer = await createUser(pool, 'CUSTOMER');
    const outsider = await createUser(pool, 'CUSTOMER');
    const orderId = await insertOrder(pool, { customerId: customer.id, merchantId, status: 'ACCEPTED' });
    const c = clientFor(customer.token);
    const thread = await c.chat.openOrderThread(orderId);
    expect(thread.order_id).toBe(orderId);
    expect((await c.chat.send(thread.id, 'hello')).body).toBe('hello');
    expect((await clientFor(owner.token).chat.list(thread.id)).map((m) => m.body)).toEqual(['hello']);
    expect((await c.chat.threads()).map((t) => t.id)).toContain(thread.id);
    await expect(clientFor(outsider.token).chat.list(thread.id)).rejects.toMatchObject({ status: 403 });
    await expect(clientFor(outsider.token).chat.openOrderThread(orderId)).rejects.toMatchObject({ status: 404 });
  });

  it('finance views are owner-scoped, read-only and empty while settlement creation is disabled', async () => {
    const owner = await createUser(pool, 'MERCHANT');
    const merchantId = await createMerchant(pool, owner.id);
    const stranger = await createUser(pool, 'MERCHANT');
    expect(await clientFor(owner.token).finance.merchantSettlements(merchantId)).toEqual([]);
    await expect(clientFor(stranger.token).finance.merchantSettlements(merchantId)).rejects.toMatchObject({ status: 403 });

    const driver = await createUser(pool, 'DRIVER');
    const driverProfileId = await createDriverProfile(pool, driver.id);
    const otherDriver = await createUser(pool, 'DRIVER');
    expect(await clientFor(driver.token).finance.driverEarnings(driverProfileId)).toEqual([]);
    await expect(clientFor(otherDriver.token).finance.driverEarnings(driverProfileId)).rejects.toMatchObject({ status: 403 });
    await expect(clientFor((await createUser(pool, 'CUSTOMER')).token).finance.driverEarnings(driverProfileId)).rejects.toMatchObject({ status: 403 });

    const before = await pool.query('SELECT (SELECT count(*) FROM driver_earnings) AS e, (SELECT count(*) FROM merchant_settlements) AS s');
    await clientFor(owner.token).finance.merchantSettlements(merchantId);
    const after = await pool.query('SELECT (SELECT count(*) FROM driver_earnings) AS e, (SELECT count(*) FROM merchant_settlements) AS s');
    expect(after.rows[0]).toEqual(before.rows[0]);
  });
});
