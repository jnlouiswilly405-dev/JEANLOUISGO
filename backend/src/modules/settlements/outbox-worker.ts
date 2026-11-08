import { Pool } from "pg";

type OutboxEvent = {
  id: string;
  event_type: string;
  aggregate_type: string;
  aggregate_id: string;
  dedupe_key: string;
  payload: Record<string, unknown>;
  attempts: number;
  lease_token: string;
};

export type OutboxHandler = (event: OutboxEvent) => Promise<void>;

/**
 * Claims one event with SKIP LOCKED, executes an injected idempotent handler,
 * then records success or a retryable failure. The handler is deliberately
 * injected: settlement math/provider actions are not guessed here.
 */
export async function processNextOutboxEvent(
  pool: Pool,
  handler: OutboxHandler,
  maxAttempts = 8,
): Promise<"EMPTY" | "PROCESSED" | "FAILED"> {
  const client = await pool.connect();
  let event: OutboxEvent | undefined;
  try {
    await client.query("BEGIN");
    const claimed = await client.query(
      `WITH candidate AS (
         SELECT id
         FROM event_outbox
         WHERE (
           status IN ('PENDING','FAILED') AND available_at <= now()
         ) OR (
           status='PROCESSING' AND lease_until < now()
         )
         ORDER BY created_at
         FOR UPDATE SKIP LOCKED
         LIMIT 1
       )
       UPDATE event_outbox o
       SET status='PROCESSING',
           attempts=o.attempts+1,
           lease_until=now() + interval '5 minutes',
           lease_token=gen_random_uuid(),
           last_error=NULL
       FROM candidate
       WHERE o.id=candidate.id
       RETURNING o.id, o.event_type, o.aggregate_type, o.aggregate_id,
                 o.dedupe_key, o.payload, o.attempts, o.lease_token`,
    );
    event = claimed.rows[0];
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  if (!event) return "EMPTY";

  try {
    await handler(event);
    const completed = await pool.query(
      `UPDATE event_outbox
       SET status='PROCESSED', processed_at=now(), lease_until=NULL,
           lease_token=NULL, last_error=NULL
       WHERE id=$1 AND status='PROCESSING' AND lease_token=$2
       RETURNING id`,
      [event.id, event.lease_token],
    );
    if (completed.rowCount !== 1) {
      // The lease expired or was reclaimed while the handler was running.
      // Do not report this worker as the owner of the completed event.
      return "FAILED";
    }
    return "PROCESSED";
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN_OUTBOX_ERROR";
    const terminal = event.attempts >= maxAttempts;
    await pool.query(
      `UPDATE event_outbox
       SET status=$3,
           available_at=now() + (LEAST(attempts, 10) * interval '1 minute'),
           lease_until=NULL, lease_token=NULL,
           last_error=$4
       WHERE id=$1 AND status='PROCESSING' AND lease_token=$2`,
      [event.id, event.lease_token, terminal ? "BLOCKED" : "FAILED", message.slice(0, 1000)],
    );
    return "FAILED";
  }
}
