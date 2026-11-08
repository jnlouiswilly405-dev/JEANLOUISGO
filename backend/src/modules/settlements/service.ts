import { Pool } from "pg";

export async function createSettlementForDeliveredOrder(
  pool: Pool,
  orderId: string,
  driverId: string,
  merchantId: string,
  grossAmountCents: number,
  driverPlatformFeeCents: number,
  merchantCommissionCents: number,
  bonusAmountCents = 0,
) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    for (const [name, amount] of Object.entries({
      grossAmountCents, driverPlatformFeeCents,
      merchantCommissionCents, bonusAmountCents,
    })) {
      if (!Number.isSafeInteger(amount) || amount < 0) {
        throw new Error(`INVALID_SETTLEMENT_CENTS:${name}`);
      }
    }
    if (driverPlatformFeeCents > grossAmountCents + bonusAmountCents) {
      throw new Error("DRIVER_FEE_EXCEEDS_GROSS");
    }
    if (merchantCommissionCents > grossAmountCents) {
      throw new Error("MERCHANT_COMMISSION_EXCEEDS_GROSS");
    }

    const order = await client.query(
      `SELECT id, status, merchant_id, driver_profile_id, currency, total_cents
       FROM orders WHERE id=$1 FOR UPDATE`,
      [orderId],
    );
    if (!order.rows[0]) throw new Error("ORDER_NOT_FOUND");
    if (order.rows[0].status !== "DELIVERED") {
      throw new Error("ORDER_NOT_DELIVERED");
    }
    if (order.rows[0].merchant_id !== merchantId) {
      throw new Error("SETTLEMENT_MERCHANT_MISMATCH");
    }
    if (order.rows[0].driver_profile_id !== driverId) {
      throw new Error("SETTLEMENT_DRIVER_MISMATCH");
    }
    if (order.rows[0].total_cents !== grossAmountCents) {
      throw new Error("SETTLEMENT_GROSS_DOES_NOT_MATCH_ORDER");
    }
    // Nothing is settled for money that was not captured: require a SUCCEEDED payment covering the order total.
    const captured = await client.query(
      `SELECT 1 FROM payments WHERE order_id=$1 AND status='SUCCEEDED' AND amount_cents=$2 LIMIT 1`,
      [orderId, grossAmountCents],
    );
    if (!captured.rowCount) throw new Error("PAYMENT_NOT_CAPTURED");

    const driverNetCents =
      grossAmountCents - driverPlatformFeeCents + bonusAmountCents;
    const merchantNetCents = grossAmountCents - merchantCommissionCents;

    // Existing rows are never overwritten (the order row lock above serializes callers): an identical
    // request returns the stored rows, a different one is rejected.
    const existingDriver = await client.query(`SELECT * FROM driver_earnings WHERE order_id=$1`, [orderId]);
    const existingMerchant = await client.query(`SELECT * FROM merchant_settlements WHERE order_id=$1`, [orderId]);
    if (existingDriver.rowCount || existingMerchant.rowCount) {
      const d = existingDriver.rows[0];
      const m = existingMerchant.rows[0];
      const n = (v: unknown) => Number(v);
      const same = d && m
        && d.driver_id === driverId && n(d.gross_amount_cents) === grossAmountCents
        && n(d.platform_fee_cents) === driverPlatformFeeCents && n(d.bonus_amount_cents) === bonusAmountCents
        && n(d.net_amount_cents) === driverNetCents
        && m.merchant_id === merchantId && n(m.gross_amount_cents) === grossAmountCents
        && n(m.commission_amount_cents) === merchantCommissionCents && n(m.net_amount_cents) === merchantNetCents;
      if (!same) throw new Error("SETTLEMENT_ALREADY_EXISTS");
      await client.query("COMMIT");
      return { driverEarning: d, merchantSettlement: m };
    }

    const driver = await client.query(
      `INSERT INTO driver_earnings
       (driver_id, order_id, gross_amount, platform_fee, bonus_amount, net_amount,
        gross_amount_cents, platform_fee_cents, bonus_amount_cents, net_amount_cents,
        currency, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'ELIGIBLE')
       RETURNING *`,
      [driverId, orderId, grossAmountCents / 100,
       driverPlatformFeeCents / 100, bonusAmountCents / 100,
       driverNetCents / 100, grossAmountCents, driverPlatformFeeCents,
       bonusAmountCents, driverNetCents, order.rows[0].currency],
    );

    const merchant = await client.query(
      `INSERT INTO merchant_settlements
       (merchant_id, order_id, gross_amount, commission_amount, net_amount,
        gross_amount_cents, commission_amount_cents, net_amount_cents,
        currency, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'ELIGIBLE')
       RETURNING *`,
      [merchantId, orderId, grossAmountCents / 100,
       merchantCommissionCents / 100, merchantNetCents / 100,
       grossAmountCents, merchantCommissionCents, merchantNetCents,
       order.rows[0].currency],
    );

    await client.query("COMMIT");
    return { driverEarning: driver.rows[0], merchantSettlement: merchant.rows[0] };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

export async function listEligibleDriverEarnings(pool: Pool, driverId: string) {
  const { rows } = await pool.query(
    `SELECT * FROM driver_earnings
     WHERE driver_id=$1 AND status='ELIGIBLE'
     ORDER BY created_at ASC`,
    [driverId],
  );
  return rows;
}

export async function listEligibleMerchantSettlements(pool: Pool, merchantId: string) {
  const { rows } = await pool.query(
    `SELECT * FROM merchant_settlements
     WHERE merchant_id=$1 AND status='ELIGIBLE'
     ORDER BY created_at ASC`,
    [merchantId],
  );
  return rows;
}

/**
 * Fail closed until a verified payout-provider transfer reference and
 * reconciliation workflow are implemented. A local status update is not
 * proof that money was transferred.
 */
export async function markDriverEarningsPaid(_pool: Pool, _ids: string[]): Promise<never> {
  throw new Error("PAYOUT_PROVIDER_CONFIRMATION_REQUIRED");
}

/**
 * Fail closed until a verified payout-provider transfer reference and
 * reconciliation workflow are implemented. A local status update is not
 * proof that money was transferred.
 */
export async function markMerchantSettlementsPaid(_pool: Pool, _ids: string[]): Promise<never> {
  throw new Error("PAYOUT_PROVIDER_CONFIRMATION_REQUIRED");
}
