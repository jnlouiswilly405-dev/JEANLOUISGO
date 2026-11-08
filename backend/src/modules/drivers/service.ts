import { Pool } from "pg";

export type DriverStatus = "OFFLINE" | "AVAILABLE" | "BUSY" | "SUSPENDED";

export async function createDriverProfile(pool: Pool, userId: string, vehicleType = "car") {
  const { rows } = await pool.query(
    `INSERT INTO driver_profiles (user_id, vehicle_type) VALUES ($1, $2) RETURNING *`,
    [userId, vehicleType],
  );
  return rows[0];
}

export async function setDriverStatus(pool: Pool, driverId: string, status: DriverStatus) {
  const { rows } = await pool.query(
    `UPDATE driver_profiles SET status=$2, updated_at=now() WHERE id=$1 RETURNING *`,
    [driverId, status],
  );
  if (!rows[0]) throw new Error("DRIVER_NOT_FOUND");
  return rows[0];
}

export async function updateDriverLocation(pool: Pool, driverId: string, lat: number, lng: number) {
  const { rows } = await pool.query(
    `UPDATE driver_profiles SET lat=$2, lng=$3, updated_at=now() WHERE id=$1 RETURNING *`,
    [driverId, lat, lng],
  );
  if (!rows[0]) throw new Error("DRIVER_NOT_FOUND");
  return rows[0];
}

export async function listAvailableDrivers(pool: Pool) {
  const { rows } = await pool.query(
    `SELECT * FROM driver_profiles WHERE status='AVAILABLE' ORDER BY updated_at ASC`,
  );
  return rows;
}
