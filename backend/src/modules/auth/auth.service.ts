import { randomUUID } from 'node:crypto';
import { query } from '../../db/pool.js';
import { hashPassword, verifyPassword, signToken } from './auth.crypto.js';
import type { AuthUser, UserRole } from './auth.types.js';

interface UserRow { id: string; email: string; display_name: string; role: UserRole; password_hash: string; }

export async function register(input: { email: string; displayName: string; password: string; role?: UserRole }) {
  const role = 'CUSTOMER' as const;
  const existing = await query<{ id: string }>('SELECT id FROM users WHERE lower(email)=lower($1)', [input.email]);
  if (existing.rowCount) throw new Error('Email already registered');
  const id = randomUUID();
  const passwordHash = hashPassword(input.password);
  const result = await query<UserRow>(
    `INSERT INTO users (id,email,display_name,role,password_hash) VALUES ($1,$2,$3,$4,$5) RETURNING id,email,display_name,role,password_hash`,
    [id,input.email.toLowerCase(),input.displayName,role,passwordHash]
  );
  const row = result.rows[0];
  const user: AuthUser = { id: row.id, email: row.email, displayName: row.display_name, role: row.role };
  return { user, token: signToken(user) };
}

export async function login(input: { email: string; password: string }) {
  const result = await query<UserRow>('SELECT id,email,display_name,role,password_hash FROM users WHERE lower(email)=lower($1)', [input.email]);
  const row = result.rows[0];
  if (!row || !verifyPassword(input.password, row.password_hash)) throw new Error('Invalid email or password');
  const user: AuthUser = { id: row.id, email: row.email, displayName: row.display_name, role: row.role };
  return { user, token: signToken(user) };
}
