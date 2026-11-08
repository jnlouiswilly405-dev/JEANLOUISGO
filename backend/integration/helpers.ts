import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import type { Pool } from 'pg';
import { hashPassword, signToken } from '../src/modules/auth/auth.crypto.js';
import type { UserRole } from '../src/modules/auth/auth.types.js';

/** Refuses to run against anything that does not look like a throwaway test database. */
export function assertSafeTestDatabase(): void {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required for integration tests');
  const dbName = new URL(url).pathname.replace(/^\//, '');
  if (!/_test$/.test(dbName) && process.env.INTEGRATION_ALLOW_ANY_DB !== '1') {
    throw new Error(`Refusing to run integration tests against database "${dbName}" (name must end with _test)`);
  }
}

export async function getPool(): Promise<Pool> {
  assertSafeTestDatabase();
  const { pool } = await import('../src/db/pool.js');
  if (!pool) throw new Error('Database pool is not configured');
  return pool;
}

export async function startApi(): Promise<{ base: string; close: () => Promise<void> }> {
  assertSafeTestDatabase();
  const { app } = await import('../src/server.js');
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const { port } = server.address() as AddressInfo;
  return {
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

export async function api(base: string, method: string, path: string, opts: { token?: string; body?: unknown } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await res.text();
  let json: any;
  try { json = text ? JSON.parse(text) : undefined; } catch { json = text; }
  return { status: res.status, body: json };
}

export interface TestUser { id: string; email: string; role: UserRole; token: string }

export async function createUser(pool: Pool, role: UserRole): Promise<TestUser> {
  const id = randomUUID();
  const email = `int-${role.toLowerCase()}-${id}@example.test`;
  await pool.query(
    'INSERT INTO users (id,email,display_name,role,password_hash) VALUES ($1,$2,$3,$4,$5)',
    [id, email, `Int ${role}`, role, hashPassword('integration-password')],
  );
  const token = signToken({ id, email, displayName: `Int ${role}`, role });
  return { id, email, role, token };
}

export async function createMerchant(pool: Pool, ownerUserId: string): Promise<string> {
  const r = await pool.query('INSERT INTO merchants (owner_user_id,name) VALUES ($1,$2) RETURNING id', [ownerUserId, `Merchant ${randomUUID()}`]);
  return r.rows[0].id;
}

export async function createProduct(pool: Pool, merchantId: string, priceCents: number): Promise<string> {
  const r = await pool.query('INSERT INTO products (merchant_id,name,price_cents) VALUES ($1,$2,$3) RETURNING id', [merchantId, `Product ${randomUUID()}`, priceCents]);
  return r.rows[0].id;
}

export async function createDriverProfile(pool: Pool, userId: string, status = 'AVAILABLE'): Promise<string> {
  const r = await pool.query('INSERT INTO driver_profiles (user_id,status) VALUES ($1,$2) RETURNING id', [userId, status]);
  return r.rows[0].id;
}

export async function insertOrder(pool: Pool, o: {
  customerId: string; merchantId: string; status?: string; totalCents?: number; driverProfileId?: string | null;
}): Promise<string> {
  const total = o.totalCents ?? 1000;
  const r = await pool.query(
    `INSERT INTO orders (customer_id,merchant_id,status,subtotal_cents,delivery_fee_cents,total_cents,driver_profile_id)
     VALUES ($1,$2,$3,$4,0,$4,$5) RETURNING id`,
    [o.customerId, o.merchantId, o.status ?? 'PENDING_PAYMENT', total, o.driverProfileId ?? null],
  );
  return r.rows[0].id;
}

export async function orderStatus(pool: Pool, orderId: string): Promise<string> {
  return (await pool.query('SELECT status FROM orders WHERE id=$1', [orderId])).rows[0].status;
}
