import { Pool } from "pg";

export async function createNotification(
  pool: Pool,
  userId: string,
  eventType: string,
  title: string,
  body: string,
  orderId?: string,
  data: Record<string, unknown> = {},
) {
  const { rows } = await pool.query(
    `INSERT INTO notification_events
     (user_id, order_id, event_type, title, body, data)
     VALUES ($1,$2,$3,$4,$5,$6)
     RETURNING *`,
    [userId, orderId ?? null, eventType, title, body, JSON.stringify(data)],
  );
  return rows[0];
}

export async function listNotifications(pool: Pool, userId: string, limit = 50) {
  const { rows } = await pool.query(
    `SELECT * FROM notification_events
     WHERE user_id=$1
     ORDER BY created_at DESC
     LIMIT $2`,
    [userId, Math.min(Math.max(limit, 1), 100)],
  );
  return rows;
}

export async function markNotificationRead(pool: Pool, userId: string, id: string) {
  const { rows } = await pool.query(
    `UPDATE notification_events
     SET read_at=now()
     WHERE id=$1 AND user_id=$2
     RETURNING *`,
    [id, userId],
  );
  if (!rows[0]) throw new Error("NOTIFICATION_NOT_FOUND");
  return rows[0];
}
