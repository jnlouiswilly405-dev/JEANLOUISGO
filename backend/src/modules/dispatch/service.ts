import { Pool } from "pg";
import { notifyDriverAssigned, notifyOrderStatus } from "../notifications/service.js";

export async function offerOrderToDriver(pool: Pool, orderId: string, driverId: string) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const order = await client.query(
      `SELECT id, status FROM orders WHERE id=$1 FOR UPDATE`, [orderId]
    );
    if (!order.rows[0]) throw new Error("ORDER_NOT_FOUND");
    if (order.rows[0].status !== "READY") {
      throw new Error("ORDER_NOT_DISPATCHABLE");
    }

    const driver = await client.query(
      `SELECT id, status FROM driver_profiles WHERE id=$1 FOR UPDATE`, [driverId]
    );
    if (!driver.rows[0]) throw new Error("DRIVER_NOT_FOUND");
    if (driver.rows[0].status !== "AVAILABLE") throw new Error("DRIVER_NOT_AVAILABLE");

    const assignment = await client.query(
      `INSERT INTO dispatch_assignments (order_id, driver_id, status)
       VALUES ($1,$2,'OFFERED')
       ON CONFLICT (order_id, driver_id)
       DO UPDATE SET status='OFFERED', offered_at=now(), responded_at=NULL
       RETURNING *`,
      [orderId, driverId]
    );

    await client.query(
      `UPDATE driver_profiles SET status='BUSY', updated_at=now() WHERE id=$1`, [driverId]
    );
    await client.query(
      `UPDATE orders SET driver_profile_id=$2 WHERE id=$1`, [orderId, driverId]
    );
    await client.query(`UPDATE orders SET status='ASSIGNED' WHERE id=$1`, [orderId]);
    await notifyOrderStatus(client, orderId, "ASSIGNED");
    await notifyDriverAssigned(client, orderId, driverId);
    await client.query("COMMIT");
    return assignment.rows[0];
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

export async function acceptAssignment(pool: Pool, assignmentId: string, driverId: string) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `SELECT da.*, o.id AS order_id, o.status AS order_status,
              o.driver_profile_id AS assigned_driver_profile_id
       FROM dispatch_assignments da
       JOIN orders o ON o.id=da.order_id
       WHERE da.id=$1 AND da.driver_id=$2
       FOR UPDATE OF da, o`,
      [assignmentId, driverId]
    );
    if (!rows[0]) throw new Error("ASSIGNMENT_NOT_FOUND");
    if (rows[0].status !== "OFFERED") throw new Error("ASSIGNMENT_NOT_OFFERED");
    if (rows[0].order_status !== "ASSIGNED" ||
        rows[0].assigned_driver_profile_id !== driverId) {
      throw new Error("ASSIGNMENT_ORDER_MISMATCH");
    }

    const result = await client.query(
      `UPDATE dispatch_assignments SET status='ACCEPTED', responded_at=now()
       WHERE id=$1 RETURNING *`, [assignmentId]
    );
    await client.query(`UPDATE orders SET status='PICKED_UP' WHERE id=$1`, [rows[0].order_id]);
    await client.query("COMMIT");
    return result.rows[0];
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

export async function rejectAssignment(pool: Pool, assignmentId: string, driverId: string) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `SELECT da.id, da.order_id, da.status,
              o.status AS order_status,
              o.driver_profile_id AS assigned_driver_profile_id
       FROM dispatch_assignments da
       JOIN orders o ON o.id=da.order_id
       WHERE da.id=$1 AND da.driver_id=$2
       FOR UPDATE OF da, o`,
      [assignmentId, driverId]
    );
    if (!rows[0]) throw new Error("ASSIGNMENT_NOT_FOUND");
    if (rows[0].status !== "OFFERED") throw new Error("ASSIGNMENT_NOT_OFFERED");

    await client.query(
      `UPDATE dispatch_assignments SET status='REJECTED', responded_at=now() WHERE id=$1`,
      [assignmentId]
    );
    // Only release this driver and reopen the order if this offer still owns it.
    if (rows[0].order_status === "ASSIGNED" &&
        rows[0].assigned_driver_profile_id === driverId) {
      await client.query(
        `UPDATE driver_profiles SET status='AVAILABLE', updated_at=now() WHERE id=$1`,
        [driverId]
      );
      await client.query(
        `UPDATE orders SET status='READY', driver_profile_id=NULL WHERE id=$1 AND status='ASSIGNED' AND driver_profile_id=$2`,
        [rows[0].order_id, driverId]
      );
    }
    await client.query("COMMIT");
    return { ok: true };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
