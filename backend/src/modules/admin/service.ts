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
