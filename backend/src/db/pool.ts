import pg from 'pg';
import { env } from '../config/env.js';

export const pool = env.DATABASE_URL
  ? new pg.Pool({ connectionString: env.DATABASE_URL, max: 10 })
  : null;

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, values: unknown[] = []) {
  if (!pool) throw new Error('DATABASE_URL is not configured');
  return pool.query<T>(text, values);
}
