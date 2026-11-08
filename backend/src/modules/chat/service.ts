import { Pool } from "pg";

export async function createThread(
  pool: Pool,
  orderId: string | null,
  participants: Array<{ userId: string; role: string }>,
) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `INSERT INTO chat_threads (order_id) VALUES ($1) RETURNING *`,
      [orderId],
    );
    const thread = rows[0];

    for (const participant of participants) {
      await client.query(
        `INSERT INTO chat_participants (thread_id, user_id, role)
         VALUES ($1,$2,$3)`,
        [thread.id, participant.userId, participant.role],
      );
    }

    await client.query("COMMIT");
    return thread;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

export async function sendMessage(
  pool: Pool,
  threadId: string,
  senderId: string,
  body: string,
  messageType = "TEXT",
) {
  const clean = body.trim();
  if (!clean) throw new Error("MESSAGE_EMPTY");

  const participant = await pool.query(
    `SELECT t.closed_at FROM chat_participants p
     JOIN chat_threads t ON t.id=p.thread_id
     WHERE p.thread_id=$1 AND p.user_id=$2`,
    [threadId, senderId],
  );
  if (!participant.rows[0]) throw new Error("NOT_A_PARTICIPANT");
  if (participant.rows[0].closed_at) throw new Error("THREAD_CLOSED");

  const { rows } = await pool.query(
    `INSERT INTO chat_messages
     (thread_id, sender_id, body, message_type)
     VALUES ($1,$2,$3,$4)
     RETURNING *`,
    [threadId, senderId, clean, messageType],
  );
  return rows[0];
}

export async function listMessages(pool: Pool, threadId: string, userId: string, limit = 100) {
  const participant = await pool.query(
    `SELECT 1 FROM chat_participants WHERE thread_id=$1 AND user_id=$2`,
    [threadId, userId],
  );
  if (!participant.rows[0]) throw new Error("NOT_A_PARTICIPANT");

  const { rows } = await pool.query(
    `SELECT * FROM chat_messages
     WHERE thread_id=$1 AND deleted_at IS NULL
     ORDER BY created_at ASC
     LIMIT $2`,
    [threadId, Math.min(Math.max(limit, 1), 500)],
  );
  return rows;
}

const CHAT_ORDER_STATUSES = ["PAID", "ACCEPTED", "PREPARING", "READY", "ASSIGNED", "PICKED_UP", "IN_TRANSIT", "DELIVERED"];

/**
 * Returns the chat thread of an order, creating it on first use. Only the order's customer,
 * merchant owner and currently assigned driver may open it; they are its only participants.
 * Admins and strangers get ORDER_NOT_FOUND so order ids are not probeable.
 */
export async function getOrCreateOrderThread(pool: Pool, orderId: string, userId: string) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Serialises concurrent first-opens of the same order's thread (the table has no unique order_id).
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`chat:${orderId}`]);

    const order = await client.query(
      `SELECT o.status, o.customer_id, m.owner_user_id AS merchant_owner_id,
              dp.user_id AS driver_profile_user_id, d.user_id AS legacy_driver_user_id
       FROM orders o
       LEFT JOIN merchants m ON m.id=o.merchant_id
       LEFT JOIN driver_profiles dp ON dp.id=o.driver_profile_id
       LEFT JOIN drivers d ON d.id=o.driver_id
       WHERE o.id=$1`,
      [orderId],
    );
    const o = order.rows[0];
    if (!o) throw new Error("ORDER_NOT_FOUND");

    const driverUserId: string | null = o.driver_profile_user_id ?? o.legacy_driver_user_id ?? null;
    const parties: Array<{ userId: string; role: string }> = [{ userId: o.customer_id, role: "CUSTOMER" }];
    if (o.merchant_owner_id) parties.push({ userId: o.merchant_owner_id, role: "MERCHANT" });
    if (driverUserId) parties.push({ userId: driverUserId, role: "DRIVER" });
    if (!parties.some((p) => p.userId === userId)) throw new Error("ORDER_NOT_FOUND");

    let thread = (await client.query(
      `SELECT * FROM chat_threads WHERE order_id=$1 ORDER BY created_at ASC LIMIT 1`, [orderId],
    )).rows[0];
    if (!thread) {
      if (!CHAT_ORDER_STATUSES.includes(o.status)) throw new Error("CHAT_NOT_AVAILABLE");
      thread = (await client.query(`INSERT INTO chat_threads (order_id) VALUES ($1) RETURNING *`, [orderId])).rows[0];
    }

    for (const p of parties) {
      await client.query(
        `INSERT INTO chat_participants (thread_id, user_id, role) VALUES ($1,$2,$3)
         ON CONFLICT (thread_id, user_id) DO NOTHING`,
        [thread.id, p.userId, p.role],
      );
    }
    // A reassigned driver loses access to the thread.
    await client.query(
      `DELETE FROM chat_participants WHERE thread_id=$1 AND role='DRIVER' AND user_id IS DISTINCT FROM $2`,
      [thread.id, driverUserId],
    );

    await client.query("COMMIT");
    return thread;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

export async function listThreadsForUser(pool: Pool, userId: string) {
  const { rows } = await pool.query(
    `SELECT t.id, t.order_id, t.created_at, t.closed_at,
            (SELECT max(created_at) FROM chat_messages m WHERE m.thread_id=t.id AND m.deleted_at IS NULL) AS last_message_at
     FROM chat_threads t
     JOIN chat_participants p ON p.thread_id=t.id
     WHERE p.user_id=$1
     ORDER BY COALESCE((SELECT max(created_at) FROM chat_messages m WHERE m.thread_id=t.id), t.created_at) DESC
     LIMIT 100`,
    [userId],
  );
  return rows;
}
