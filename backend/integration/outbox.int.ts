import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { processNextOutboxEvent } from '../src/modules/settlements/outbox-worker.js';
import { getPool } from './helpers.js';

let pool: Pool;
const created: string[] = [];

async function enqueue(): Promise<{ id: string; dedupeKey: string }> {
  const aggregateId = randomUUID();
  const dedupeKey = `int-outbox:${aggregateId}`;
  const r = await pool.query(
    `INSERT INTO event_outbox (event_type,aggregate_type,aggregate_id,dedupe_key,payload)
     VALUES ('INT_TEST','TEST',$1,$2,'{}'::jsonb) RETURNING id`,
    [aggregateId, dedupeKey],
  );
  created.push(r.rows[0].id);
  return { id: r.rows[0].id, dedupeKey };
}
const row = async (id: string) => (await pool.query('SELECT * FROM event_outbox WHERE id=$1', [id])).rows[0];

beforeAll(async () => {
  pool = await getPool();
  // The worker claims any claimable row, so these tests need an otherwise idle outbox.
  const foreign = (await pool.query(
    `SELECT count(*)::int n FROM event_outbox
     WHERE (status IN ('PENDING','FAILED') AND available_at <= now()) OR (status='PROCESSING' AND lease_until < now())`,
  )).rows[0].n;
  if (foreign > 0) throw new Error(`Outbox has ${foreign} claimable rows; run outbox integration tests against a clean test database`);
});
afterAll(async () => {
  if (created.length) await pool.query('DELETE FROM event_outbox WHERE id = ANY($1::uuid[])', [created]);
});

describe('outbox worker', () => {
  it('returns EMPTY when nothing is claimable', async () => {
    expect(await processNextOutboxEvent(pool, async () => {})).toBe('EMPTY');
  });

  it('claims an event, passes the lease token to the handler and marks it PROCESSED', async () => {
    const e = await enqueue();
    let seen: any;
    expect(await processNextOutboxEvent(pool, async (ev) => { seen = ev; })).toBe('PROCESSED');
    expect(seen.id).toBe(e.id);
    expect(seen.attempts).toBe(1);
    const r = await row(e.id);
    expect(r.status).toBe('PROCESSED');
    expect(r.lease_token).toBeNull();
    expect(r.processed_at).not.toBeNull();
    expect(await processNextOutboxEvent(pool, async () => {})).toBe('EMPTY');
  });

  it('schedules a delayed retry when the handler fails', async () => {
    const e = await enqueue();
    expect(await processNextOutboxEvent(pool, async () => { throw new Error('boom'); })).toBe('FAILED');
    const r = await row(e.id);
    expect(r.status).toBe('FAILED');
    expect(r.attempts).toBe(1);
    expect(r.last_error).toBe('boom');
    expect(new Date(r.available_at).getTime()).toBeGreaterThan(Date.now());
    expect(await processNextOutboxEvent(pool, async () => {})).toBe('EMPTY');
  });

  it('moves the event to BLOCKED at the attempt limit and never retries it', async () => {
    const e = await enqueue();
    expect(await processNextOutboxEvent(pool, async () => { throw new Error('PAYOUT_PROVIDER_CONFIRMATION_REQUIRED'); }, 1)).toBe('FAILED');
    expect((await row(e.id)).status).toBe('BLOCKED');
    await pool.query('UPDATE event_outbox SET available_at=now() - interval \'1 hour\' WHERE id=$1', [e.id]);
    expect(await processNextOutboxEvent(pool, async () => {})).toBe('EMPTY');
    expect((await row(e.id)).status).toBe('BLOCKED');
  });

  it('does not hand the same event to concurrent workers (SKIP LOCKED)', async () => {
    const events = await Promise.all([enqueue(), enqueue(), enqueue()]);
    const handled: string[] = [];
    const results = await Promise.all(
      events.map(() => processNextOutboxEvent(pool, async (ev) => { handled.push(ev.id); await new Promise((r) => setTimeout(r, 100)); })),
    );
    expect(results).toEqual(['PROCESSED', 'PROCESSED', 'PROCESSED']);
    expect(new Set(handled).size).toBe(3);
    expect([...handled].sort()).toEqual(events.map((e) => e.id).sort());
  });

  it('reclaims an event whose lease expired', async () => {
    const e = await enqueue();
    await pool.query(
      "UPDATE event_outbox SET status='PROCESSING', attempts=1, lease_until=now() - interval '1 minute', lease_token=gen_random_uuid() WHERE id=$1",
      [e.id],
    );
    let attempts = 0;
    expect(await processNextOutboxEvent(pool, async (ev) => { attempts = ev.attempts; })).toBe('PROCESSED');
    expect(attempts).toBe(2);
    expect((await row(e.id)).status).toBe('PROCESSED');
  });

  it('blocks an expired-lease event that has exhausted its attempts instead of reclaiming it', async () => {
    const e = await enqueue();
    await pool.query(
      "UPDATE event_outbox SET status='PROCESSING', attempts=3, lease_until=now() - interval '1 minute', lease_token=gen_random_uuid() WHERE id=$1",
      [e.id],
    );
    let handled = false;
    expect(await processNextOutboxEvent(pool, async () => { handled = true; }, 3)).toBe('EMPTY');
    expect(handled).toBe(false);
    const r = await row(e.id);
    expect(r.status).toBe('BLOCKED');
    expect(r.last_error).toBe('OUTBOX_MAX_ATTEMPTS_EXCEEDED_LEASE_EXPIRED');
    expect(r.lease_token).toBeNull();
    expect(await processNextOutboxEvent(pool, async () => {}, 3)).toBe('EMPTY');
    expect((await row(e.id)).status).toBe('BLOCKED');
  });

  it('does not block an expired-lease event below the attempt limit, nor a live lease at the limit', async () => {
    const below = await enqueue();
    const live = await enqueue();
    await pool.query(
      "UPDATE event_outbox SET status='PROCESSING', attempts=2, lease_until=now() - interval '1 minute', lease_token=gen_random_uuid() WHERE id=$1",
      [below.id],
    );
    await pool.query(
      "UPDATE event_outbox SET status='PROCESSING', attempts=3, lease_until=now() + interval '5 minutes', lease_token=gen_random_uuid() WHERE id=$1",
      [live.id],
    );
    expect(await processNextOutboxEvent(pool, async () => {}, 3)).toBe('PROCESSED');
    expect((await row(below.id)).status).toBe('PROCESSED');
    expect((await row(live.id)).status).toBe('PROCESSING');
  });

  it('stops a stale worker from overwriting an event that another worker finished', async () => {
    const e = await enqueue();
    const staleResult = await processNextOutboxEvent(pool, async () => {
      // While the first worker is still running, its lease expires and a second worker completes the event.
      await pool.query("UPDATE event_outbox SET lease_until=now() - interval '1 minute' WHERE id=$1", [e.id]);
      expect(await processNextOutboxEvent(pool, async () => {})).toBe('PROCESSED');
    });
    expect(staleResult).toBe('FAILED');
    const r = await row(e.id);
    expect(r.status).toBe('PROCESSED');
    expect(r.attempts).toBe(2);
  });

  it('does not let a stale failing worker revert an event another worker finished', async () => {
    const e = await enqueue();
    await processNextOutboxEvent(pool, async () => {
      await pool.query("UPDATE event_outbox SET lease_until=now() - interval '1 minute' WHERE id=$1", [e.id]);
      await processNextOutboxEvent(pool, async () => {});
      throw new Error('late failure');
    });
    expect((await row(e.id)).status).toBe('PROCESSED');
  });
});
