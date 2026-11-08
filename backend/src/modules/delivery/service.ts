import { Pool } from "pg";

const transitions: Record<string, { next: string; event: string }> = {
  PICKUP: { next: "IN_TRANSIT", event: "PICKED_UP" },
  IN_TRANSIT: { next: "DELIVERED", event: "DELIVERED" },
};

export async function advanceDelivery(
  pool: Pool,
  orderId: string,
  driverId: string,
  action: "PICKED_UP" | "DELIVERED",
  metadata: Record<string, unknown> = {},
) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows } = await client.query(
      `SELECT id, status, driver_profile_id, merchant_id FROM orders WHERE id=$1 FOR UPDATE`,
      [orderId],
    );
    const driverProfile = await client.query(
      `SELECT id FROM driver_profiles WHERE user_id=$1`, [driverId]
    );
    if (!driverProfile.rows[0]) throw new Error("DRIVER_PROFILE_NOT_FOUND");
    const driverProfileId = driverProfile.rows[0].id;
    if (!rows[0]) throw new Error("ORDER_NOT_FOUND");
    if (rows[0].driver_profile_id !== driverProfileId) throw new Error("ORDER_NOT_ASSIGNED_TO_DRIVER");

    const current = rows[0].status;
    const expected = action === "PICKED_UP" ? "PICKED_UP" : "IN_TRANSIT";
    const next = action === "PICKED_UP" ? "IN_TRANSIT" : "DELIVERED";

    if (current !== expected) throw new Error("INVALID_DELIVERY_TRANSITION");

    await client.query(
      `UPDATE orders SET status=$2 WHERE id=$1`,
      [orderId, next],
    );

    const event = await client.query(
      `INSERT INTO delivery_events
       (order_id, driver_id, event_type, metadata)
       VALUES ($1,$2,$3,$4)
       RETURNING *`,
      [orderId, driverProfileId, action, JSON.stringify(metadata)],
    );

    if (action === "DELIVERED") {
      // Persist the settlement request in the same transaction as delivery.
      // A later worker can process it idempotently; no money is marked paid here.
      await client.query(
        `INSERT INTO event_outbox
         (event_type, aggregate_type, aggregate_id, dedupe_key, payload)
         VALUES ('SETTLEMENT_REQUESTED', 'ORDER', $1, $2, $3::jsonb)
         ON CONFLICT (dedupe_key) DO NOTHING`,
        [
          orderId,
          `settlement-requested:${orderId}`,
          JSON.stringify({
            orderId,
            driverProfileId,
            merchantId: rows[0].merchant_id ?? null,
            requestedAt: new Date().toISOString(),
          }),
        ],
      );
      await client.query(
        `UPDATE driver_profiles SET status='AVAILABLE', updated_at=now()
         WHERE id=$1`,
        [driverProfileId],
      );
      await client.query(
        `UPDATE dispatch_assignments
         SET status='COMPLETED', completed_at=now()
         WHERE order_id=$1 AND driver_id=$2 AND status='ACCEPTED'`,
        [orderId, driverProfileId],
      );
    }

    await client.query("COMMIT");
    return { orderStatus: next, event: event.rows[0] };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
