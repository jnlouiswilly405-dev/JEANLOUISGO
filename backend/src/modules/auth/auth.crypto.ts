import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { env } from '../../config/env.js';
import type { AuthUser } from './auth.types.js';

const b64url = (value: string | Buffer) => Buffer.from(value).toString('base64url');

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

export function verifyPassword(password: string, encoded: string): boolean {
  const [algorithm, saltText, hashText] = encoded.split('$');
  if (algorithm !== 'scrypt' || !saltText || !hashText) return false;
  const salt = Buffer.from(saltText, 'base64url');
  const expected = Buffer.from(hashText, 'base64url');
  const actual = scryptSync(password, salt, expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function signToken(user: AuthUser): string {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({ sub: user.id, email: user.email, role: user.role, name: user.displayName, exp: Math.floor(Date.now()/1000) + env.JWT_TTL_SECONDS }));
  const input = `${header}.${payload}`;
  const signature = createHmac('sha256', env.JWT_SECRET).update(input).digest('base64url');
  return `${input}.${signature}`;
}

export function verifyToken(token: string): AuthUser {
  const [header, payload, signature] = token.split('.');
  if (!header || !payload || !signature) throw new Error('Invalid token');
  const expected = createHmac('sha256', env.JWT_SECRET).update(`${header}.${payload}`).digest('base64url');
  if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) throw new Error('Invalid token');
  const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString()) as AuthUser & { sub: string; exp: number; name?: string };
  if (!decoded.exp || decoded.exp < Math.floor(Date.now()/1000)) throw new Error('Token expired');
  return { id: decoded.sub, email: decoded.email, displayName: decoded.displayName ?? decoded.name, role: decoded.role };
}
