import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  api, createDriverProfile, createMerchant, createProduct, createUser, getPool, insertOrder, orderStatus, startApi, type TestUser,
} from './helpers.js';

let base: string;
let close: () => Promise<void>;
let customerA: TestUser;
let customerB: TestUser;
let merchantOwner: TestUser;
let otherMerchantOwner: TestUser;
let driverUser: TestUser;
let otherDriver: TestUser;
let admin: TestUser;
let merchantId: string;
let otherMerchantId: string;
let productId: string;
let otherProductId: string;
const deliveryAddress = {
  line1: '1 Test Street',
  city: 'Spring Valley',
  stateCode: 'NY',
  postalCode: '10977',
};

beforeAll(async () => {
  const pool = await getPool();
  ({ base, close } = await startApi());
  [customerA, customerB, merchantOwner, otherMerchantOwner, driverUser, otherDriver, admin] = await Promise.all(
    (['CUSTOMER', 'CUSTOMER', 'MERCHANT', 'MERCHANT', 'DRIVER', 'DRIVER', 'ADMIN'] as const).map((r) => createUser(pool, r)),
  );
  merchantId = await createMerchant(pool, merchantOwner.id);
  otherMerchantId = await createMerchant(pool, otherMerchantOwner.id);
  productId = await createProduct(pool, merchantId, 450);
  otherProductId = await createProduct(pool, otherMerchantId, 100);
});
afterAll(async () => { await close?.(); });

describe('order creation', () => {
  it('prices the order from the database and ignores client-supplied prices and customerId', async () => {
    const res = await api(base, 'POST', '/api/orders', {
      token: customerA.token,
      body: { merchantId, customerId: customerB.id, deliveryAddress, deliveryFeeCents: 250, items: [{ productId, quantity: 3, unitPriceCents: 1, name: 'cheap' }] },
    });
    expect(res.status).toBe(201);
    expect(res.body.customerId).toBe(customerA.id);
    expect(res.body.subtotalCents).toBe(1350);
    expect(res.body.totalCents).toBe(1600);
    expect(res.body.status).toBe('PENDING_PAYMENT');
    expect(res.body.deliveryAddress).toEqual(deliveryAddress);
    const pool = await getPool();
    const item = (await pool.query('SELECT unit_price_cents,quantity FROM order_items WHERE order_id=$1', [res.body.id])).rows[0];
    expect(item).toEqual({ unit_price_cents: 450, quantity: 3 });
    expect((await pool.query('SELECT delivery_address_line1,delivery_city,delivery_state_code,delivery_postal_code FROM orders WHERE id=$1', [res.body.id])).rows[0])
      .toEqual({ delivery_address_line1: deliveryAddress.line1, delivery_city: deliveryAddress.city, delivery_state_code: 'NY', delivery_postal_code: '10977' });
  });

  it('checks only the active ZIP allowlist without requiring authentication', async () => {
    const active = await api(base, 'GET', '/api/service-areas/eligibility?stateCode=ny&postalCode=10977');
    expect(active).toEqual({ status: 200, body: { eligible: true, areaName: 'Spring Valley' } });
    const second = await api(base, 'GET', '/api/service-areas/eligibility?stateCode=NY&postalCode=10954');
    expect(second.body).toEqual({ eligible: true, areaName: 'Nanuet' });
    const outside = await api(base, 'GET', '/api/service-areas/eligibility?stateCode=NY&postalCode=00000');
    expect(outside.body).toEqual({ eligible: false });
    expect((await api(base, 'GET', '/api/service-areas/eligibility?stateCode=NY&postalCode=1095')).status).toBe(400);
  });

  it('requires a delivery address and rejects order creation outside active ZIPs', async () => {
    const missing = await api(base, 'POST', '/api/orders', {
      token: customerA.token,
      body: { merchantId, items: [{ productId, quantity: 1 }] },
    });
    expect(missing.status).toBe(400);

    const pool = await getPool();
    const before = (await pool.query('SELECT count(*)::int AS n FROM orders WHERE customer_id=$1', [customerA.id])).rows[0].n;
    const outside = await api(base, 'POST', '/api/orders', {
      token: customerA.token,
      body: { merchantId, deliveryAddress: { ...deliveryAddress, postalCode: '00000' }, items: [{ productId, quantity: 1 }] },
    });
    expect(outside).toEqual({ status: 409, body: { error: 'DELIVERY_AREA_UNAVAILABLE' } });
    const after = (await pool.query('SELECT count(*)::int AS n FROM orders WHERE customer_id=$1', [customerA.id])).rows[0].n;
    expect(after).toBe(before);
  });

  it('rejects products belonging to another merchant and leaves no order behind', async () => {
    const pool = await getPool();
    const before = (await pool.query('SELECT count(*)::int AS n FROM orders WHERE customer_id=$1', [customerA.id])).rows[0].n;
    const res = await api(base, 'POST', '/api/orders', { token: customerA.token, body: { merchantId, deliveryAddress, items: [{ productId: otherProductId, quantity: 1 }] } });
    expect(res.status).toBe(400);
    const after = (await pool.query('SELECT count(*)::int AS n FROM orders WHERE customer_id=$1', [customerA.id])).rows[0].n;
    expect(after).toBe(before);
  });

  it('rejects invalid quantities and negative delivery fees', async () => {
    expect((await api(base, 'POST', '/api/orders', { token: customerA.token, body: { merchantId, deliveryAddress, items: [{ productId, quantity: 0 }] } })).status).toBe(400);
    expect((await api(base, 'POST', '/api/orders', { token: customerA.token, body: { merchantId, deliveryAddress, deliveryFeeCents: -1, items: [{ productId, quantity: 1 }] } })).status).toBe(400);
  });

  it('requires customerId when an admin creates an order', async () => {
    const body = { merchantId, deliveryAddress, items: [{ productId, quantity: 1 }] };
    expect((await api(base, 'POST', '/api/orders', { token: admin.token, body })).status).toBe(400);
    const ok = await api(base, 'POST', '/api/orders', { token: admin.token, body: { ...body, customerId: customerB.id } });
    expect(ok.status).toBe(201);
    expect(ok.body.customerId).toBe(customerB.id);
    expect(ok.body).not.toHaveProperty('deliveryAddress');
  });
});

describe('order ownership and visibility', () => {
  let orderId: string;
  beforeAll(async () => {
    const pool = await getPool();
    orderId = await insertOrder(pool, { customerId: customerA.id, merchantId, status: 'PAID' });
  });

  it('shows the order to its customer, the merchant owner and admins', async () => {
    for (const u of [customerA, merchantOwner, admin]) {
      const res = await api(base, 'GET', `/api/orders/${orderId}`, { token: u.token });
      expect(res.status, u.role).toBe(200);
      expect(res.body.id).toBe(orderId);
    }
  });

  it('hides the order from other customers, other merchants and unassigned drivers', async () => {
    for (const u of [customerB, otherMerchantOwner, driverUser]) {
      expect((await api(base, 'GET', `/api/orders/${orderId}`, { token: u.token })).status, u.role).toBe(404);
    }
  });

  it('only lists orders visible to the caller', async () => {
    const mine = await api(base, 'GET', '/api/orders', { token: customerA.token });
    expect(mine.body.map((o: any) => o.id)).toContain(orderId);
    const theirs = await api(base, 'GET', '/api/orders', { token: customerB.token });
    expect(theirs.body.map((o: any) => o.id)).not.toContain(orderId);
    const otherMerchant = await api(base, 'GET', '/api/orders', { token: otherMerchantOwner.token });
    expect(otherMerchant.body.map((o: any) => o.id)).not.toContain(orderId);
  });

  it('shows an assigned order to its driver only', async () => {
    const pool = await getPool();
    const profile = await createDriverProfile(pool, driverUser.id, 'BUSY');
    const assigned = await insertOrder(pool, { customerId: customerA.id, merchantId, status: 'ASSIGNED', driverProfileId: profile });
    await pool.query(
      `UPDATE orders SET delivery_address_line1=$2,delivery_city=$3,delivery_state_code='NY',delivery_postal_code='10977' WHERE id=$1`,
      [assigned, deliveryAddress.line1, deliveryAddress.city],
    );
    const driverOrder = await api(base, 'GET', `/api/orders/${assigned}`, { token: driverUser.token });
    expect(driverOrder.status).toBe(200);
    expect(driverOrder.body.deliveryAddress.postalCode).toBe('10977');
    const merchantOrder = await api(base, 'GET', `/api/orders/${assigned}`, { token: merchantOwner.token });
    expect(merchantOrder.body).not.toHaveProperty('deliveryAddress');
    const adminOrder = await api(base, 'GET', `/api/orders/${assigned}`, { token: admin.token });
    expect(adminOrder.body).not.toHaveProperty('deliveryAddress');
    expect((await api(base, 'GET', `/api/orders/${assigned}`, { token: otherDriver.token })).status).toBe(404);
  });
});

describe('order status transitions', () => {
  it('lets only the owning merchant move an order forward', async () => {
    const pool = await getPool();
    const id = await insertOrder(pool, { customerId: customerA.id, merchantId, status: 'PAID' });
    const other = await api(base, 'POST', `/api/orders/${id}/status`, { token: otherMerchantOwner.token, body: { status: 'ACCEPTED' } });
    expect(other.status).toBe(403);
    expect(await orderStatus(pool, id)).toBe('PAID');
    const owner = await api(base, 'POST', `/api/orders/${id}/status`, { token: merchantOwner.token, body: { status: 'ACCEPTED' } });
    expect(owner.status).toBe(200);
    expect(await orderStatus(pool, id)).toBe('ACCEPTED');
  });

  it('rejects invalid transitions even for the owner', async () => {
    const pool = await getPool();
    const id = await insertOrder(pool, { customerId: customerA.id, merchantId, status: 'PAID' });
    const res = await api(base, 'POST', `/api/orders/${id}/status`, { token: merchantOwner.token, body: { status: 'READY' } });
    expect(res.status).toBe(409);
    expect(await orderStatus(pool, id)).toBe('PAID');
  });

  it('forbids merchants from driver-only statuses and unassigned drivers from delivering', async () => {
    const pool = await getPool();
    const assignedDriver = await createUser(pool, 'DRIVER');
    const profile = await createDriverProfile(pool, assignedDriver.id, 'BUSY');
    const id = await insertOrder(pool, { customerId: customerA.id, merchantId, status: 'IN_TRANSIT', driverProfileId: profile });
    expect((await api(base, 'POST', `/api/orders/${id}/status`, { token: merchantOwner.token, body: { status: 'DELIVERED' } })).status).toBe(403);
    expect((await api(base, 'POST', `/api/orders/${id}/status`, { token: otherDriver.token, body: { status: 'DELIVERED' } })).status).toBe(403);
    expect(await orderStatus(pool, id)).toBe('IN_TRANSIT');
  });

  it('allows the assigned driver to deliver', async () => {
    const pool = await getPool();
    const user = await createUser(pool, 'DRIVER');
    const profile = await createDriverProfile(pool, user.id, 'BUSY');
    const id = await insertOrder(pool, { customerId: customerA.id, merchantId, status: 'IN_TRANSIT', driverProfileId: profile });
    const res = await api(base, 'POST', `/api/orders/${id}/status`, { token: user.token, body: { status: 'DELIVERED' } });
    expect(res.status).toBe(200);
    expect(await orderStatus(pool, id)).toBe('DELIVERED');
  });
});
