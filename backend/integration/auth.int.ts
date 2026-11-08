import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, createUser, getPool, startApi, type TestUser } from './helpers.js';

let base: string;
let close: () => Promise<void>;
let customer: TestUser;
let driver: TestUser;
let merchant: TestUser;
let admin: TestUser;

beforeAll(async () => {
  const pool = await getPool();
  ({ base, close } = await startApi());
  [customer, driver, merchant, admin] = await Promise.all(
    (['CUSTOMER', 'DRIVER', 'MERCHANT', 'ADMIN'] as const).map((r) => createUser(pool, r)),
  );
});
afterAll(async () => { await close?.(); });

describe('authentication', () => {
  const email = `int-register-${Date.now()}@example.test`;

  it('registers a customer, hashes the password and returns a usable token', async () => {
    const res = await api(base, 'POST', '/api/auth/register', { body: { email, displayName: 'Reg User', password: 'password-123' } });
    expect(res.status).toBe(201);
    expect(res.body.user.role).toBe('CUSTOMER');
    const pool = await getPool();
    const row = (await pool.query('SELECT password_hash FROM users WHERE email=$1', [email])).rows[0];
    expect(row.password_hash.startsWith('scrypt$')).toBe(true);
    expect(row.password_hash).not.toContain('password-123');
    const me = await api(base, 'GET', '/api/auth/me', { token: res.body.token });
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe(email);
  });

  it('rejects duplicate registration (case-insensitive)', async () => {
    const res = await api(base, 'POST', '/api/auth/register', { body: { email: email.toUpperCase(), displayName: 'Dup User', password: 'password-123' } });
    expect(res.status).toBe(409);
  });

  it('does not allow self-registration with a privileged role', async () => {
    const res = await api(base, 'POST', '/api/auth/register', {
      body: { email: `int-admin-try-${Date.now()}@example.test`, displayName: 'Evil', password: 'password-123', role: 'ADMIN' },
    });
    expect(res.status).toBe(400);
  });

  it('logs in with the right password and rejects wrong password or unknown email', async () => {
    expect((await api(base, 'POST', '/api/auth/login', { body: { email, password: 'password-123' } })).status).toBe(200);
    expect((await api(base, 'POST', '/api/auth/login', { body: { email, password: 'wrong-password' } })).status).toBe(401);
    expect((await api(base, 'POST', '/api/auth/login', { body: { email: 'nobody@example.test', password: 'password-123' } })).status).toBe(401);
  });

  it('requires a valid bearer token', async () => {
    expect((await api(base, 'GET', '/api/orders')).status).toBe(401);
    expect((await api(base, 'GET', '/api/orders', { token: 'not.a.token' })).status).toBe(401);
    const tampered = customer.token.slice(0, -2) + (customer.token.endsWith('AA') ? 'BB' : 'AA');
    expect((await api(base, 'GET', '/api/orders', { token: tampered })).status).toBe(401);
  });
});

describe('role-based access control', () => {
  const someId = '00000000-0000-4000-8000-000000000001';

  it('only customers and admins can create orders', async () => {
    const body = { merchantId: someId, items: [{ productId: someId, quantity: 1 }] };
    expect((await api(base, 'POST', '/api/orders', { token: driver.token, body })).status).toBe(403);
    expect((await api(base, 'POST', '/api/orders', { token: merchant.token, body })).status).toBe(403);
  });

  it('customers cannot change order status', async () => {
    const res = await api(base, 'POST', `/api/orders/${someId}/status`, { token: customer.token, body: { status: 'PAID' } });
    expect(res.status).toBe(403);
  });

  it('only admins can refund, and refunds stay disabled for admins too', async () => {
    const path = `/api/payments/${someId}/refund`;
    expect((await api(base, 'POST', path, { token: customer.token, body: { amountCents: 100 } })).status).toBe(403);
    const adminRes = await api(base, 'POST', path, { token: admin.token, body: { amountCents: 100 } });
    expect(adminRes.status).toBe(409);
    expect(adminRes.body.error).toContain('REFUND_PROVIDER_NOT_IMPLEMENTED');
  });
});
