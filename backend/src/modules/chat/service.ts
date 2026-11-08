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
    `SELECT 1 FROM chat_participants
     WHERE thread_id=$1 AND user_id=$2`,
    [threadId, senderId],
  );
  if (!participant.rows[0]) throw new Error("NOT_A_PARTICIPANT");

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
