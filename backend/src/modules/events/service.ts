import { Pool } from "pg";

export async function publishEvent(
  pool: Pool,
  aggregateType: string,
  aggregateId: string,
  eventType: string,
  payload: Record<string, unknown> = {},
) {
  const { rows } = await pool.query(
    `INSERT INTO realtime_events
     (aggregate_type, aggregate_id, event_type, payload)
     VALUES ($1,$2,$3,$4)
     RETURNING *`,
    [aggregateType, aggregateId, eventType, JSON.stringify(payload)],
  );
  return rows[0];
}
