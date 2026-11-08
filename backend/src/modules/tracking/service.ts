import { Pool } from "pg";

export async function recordDriverLocation(
  pool: Pool,
  driverId: string,
  lat: number,
  lng: number,
  orderId?: string,
  accuracyM?: number,
) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `UPDATE driver_profiles SET lat=$2, lng=$3, updated_at=now() WHERE id=$1`,
      [driverId, lat, lng],
    );
    const { rows } = await client.query(
      `INSERT INTO driver_location_events
       (driver_id, order_id, lat, lng, accuracy_m)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING *`,
      [driverId, orderId ?? null, lat, lng, accuracyM ?? null],
    );
    await client.query("COMMIT");
    return rows[0];
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

export async function getOrderTracking(pool: Pool, orderId: string, limit = 100) {
  const { rows } = await pool.query(
    `SELECT * FROM driver_location_events
     WHERE order_id=$1
     ORDER BY recorded_at DESC
     LIMIT $2`,
    [orderId, Math.min(Math.max(limit, 1), 500)],
  );
  return rows;
}
