import { Pool } from "pg";

export async function recordAuditEvent(
  pool: Pool,
  actorUserId: string | null,
  action: string,
  entityType: string,
  entityId?: string,
  metadata: Record<string, unknown> = {},
) {
  const { rows } = await pool.query(
    `INSERT INTO audit_events
     (actor_user_id, action, entity_type, entity_id, metadata)
     VALUES ($1,$2,$3,$4,$5)
     RETURNING *`,
    [actorUserId, action, entityType, entityId ?? null, JSON.stringify(metadata)],
  );
  return rows[0];
}
