import { Pool } from "pg";

export async function getAdminOrderFinancialSummary(pool: Pool, limit = 100) {
  const { rows } = await pool.query(
    `SELECT * FROM admin_order_financial_summary
     ORDER BY order_id DESC
     LIMIT $1`,
    [Math.min(Math.max(limit, 1), 500)],
  );
  return rows;
}

export async function getSystemHealth(pool: Pool) {
  const started = Date.now();
  await pool.query("SELECT 1");
  return {
    database: "UP",
    latencyMs: Date.now() - started,
    checkedAt: new Date().toISOString(),
  };
}

export type BlockedOutboxFilters = {
  eventType?: string;
  aggregateId?: string;
  limit?: number;
  offset?: number;
};

/** Strips anything that could carry secrets from an error string before it leaves the API. */
export function sanitizeOutboxError(value: string | null): string | null {
  if (value === null) return null;
  return value
    .split("\n")[0]
    .replace(/[a-z][a-z0-9+.-]*:\/\/\S+/gi, "[REDACTED_URL]")
    .replace(/\bBearer\s+\S+/gi, "[REDACTED_TOKEN]")
    .replace(/\b(?:sk|pk|rk|whsec)_[A-Za-z0-9_]+/g, "[REDACTED_KEY]")
    .replace(/[A-Za-z0-9+/=_-]{32,}/g, (m) => (/^[A-Z]+(_[A-Z0-9]+)*$/.test(m) ? m : "[REDACTED]"))
    .slice(0, 200);
}

/**
 * Read-only listing of BLOCKED outbox events. The payload and lease token are
 * intentionally never selected.
 */
export async function listBlockedOutboxEvents(pool: Pool, filters: BlockedOutboxFilters = {}) {
  const limit = Math.min(Math.max(filters.limit ?? 50, 1), 100);
  const offset = Math.max(filters.offset ?? 0, 0);
  const where = ["status='BLOCKED'"];
  const params: unknown[] = [];
  if (filters.eventType) { params.push(filters.eventType); where.push(`event_type=$${params.length}`); }
  if (filters.aggregateId) { params.push(filters.aggregateId); where.push(`aggregate_id=$${params.length}`); }
  const clause = where.join(" AND ");
  const total = await pool.query(`SELECT count(*)::int AS n FROM event_outbox WHERE ${clause}`, params);
  const { rows } = await pool.query(
    `SELECT id, event_type, aggregate_type, aggregate_id, status, attempts,
            created_at, available_at, processed_at, last_error
     FROM event_outbox
     WHERE ${clause}
     ORDER BY created_at DESC, id DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset],
  );
  return {
    items: rows.map((r) => ({
      id: r.id,
      eventType: r.event_type,
      aggregateType: r.aggregate_type,
      aggregateId: r.aggregate_id,
      status: r.status,
      attempts: r.attempts,
      createdAt: r.created_at,
      availableAt: r.available_at,
      processedAt: r.processed_at,
      failureReason: sanitizeOutboxError(r.last_error),
    })),
    total: total.rows[0].n as number,
    limit,
    offset,
  };
}
