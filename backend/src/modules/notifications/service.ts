import type { Pool } from "pg";

// Pool and PoolClient both satisfy this, so a notification can join the caller's transaction.
export type Queryable = Pick<Pool, "query">;

export async function createNotification(
  pool: Queryable,
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

// Fixed texts only: no payment data, secrets or free-form user input reach a notification.
const ORDER_TEXT: Record<string, [string, string]> = {
  ACCEPTED: ["Order accepted", "The restaurant accepted your order."],
  PREPARING: ["Order being prepared", "The restaurant is preparing your order."],
  READY: ["Order ready", "Your order is ready for pickup by a driver."],
  ASSIGNED: ["Driver assigned", "A driver was assigned to your order."],
  PICKED_UP: ["Order picked up", "Your driver picked up your order."],
  IN_TRANSIT: ["Order on its way", "Your order is on its way."],
  DELIVERED: ["Order delivered", "Your order was delivered."],
  CANCELLED: ["Order cancelled", "Your order was cancelled."],
};

/** Notifies the order's customer of a status change. Call inside the transaction that changed the status. */
export async function notifyOrderStatus(db: Queryable, orderId: string, status: string) {
  const text = ORDER_TEXT[status];
  if (!text) return;
  await db.query(
    `INSERT INTO notification_events (user_id, order_id, event_type, title, body, data)
     SELECT customer_id, id, 'ORDER_STATUS', $2, $3, jsonb_build_object('status', $4::text)
     FROM orders WHERE id=$1`,
    [orderId, text[0], text[1], status],
  );
}

/** Notifies the driver that an order was assigned to their profile. */
export async function notifyDriverAssigned(db: Queryable, orderId: string, driverProfileId: string) {
  await db.query(
    `INSERT INTO notification_events (user_id, order_id, event_type, title, body, data)
     SELECT user_id, $1::uuid, 'DRIVER_ASSIGNED', 'New delivery', 'A delivery was assigned to you.', '{}'::jsonb
     FROM driver_profiles WHERE id=$2`,
    [orderId, driverProfileId],
  );
}
