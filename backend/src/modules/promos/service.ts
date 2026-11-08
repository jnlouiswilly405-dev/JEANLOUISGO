import type { Pool, PoolClient } from "pg";

export async function validatePromo(pool: Pool, code: string, userId: string, orderTotal: number) {
  const { rows } = await pool.query(
    `SELECT * FROM promo_codes
     WHERE code=$1 AND active=true
       AND starts_at <= now()
       AND (expires_at IS NULL OR expires_at >= now())
       AND min_order_total <= $2
       AND (usage_limit IS NULL OR used_count < usage_limit)`,
    [code.trim().toUpperCase(), orderTotal],
  );
  if (!rows[0]) throw new Error("PROMO_INVALID");

  const promo = rows[0];
  const prior = await pool.query(
    `SELECT 1 FROM promo_redemptions WHERE promo_id=$1 AND user_id=$2`,
    [promo.id, userId],
  );
  if (prior.rows[0]) throw new Error("PROMO_ALREADY_USED");

  let discount =
    promo.discount_type === "PERCENT"
      ? orderTotal * Number(promo.discount_value) / 100
      : Number(promo.discount_value);

  if (promo.max_discount != null) {
    discount = Math.min(discount, Number(promo.max_discount));
  }
  discount = Math.max(0, Math.min(discount, orderTotal));

  return { promoId: promo.id, code: promo.code, discount };
}

export async function redeemPromo(
  pool: Pool,
  promoId: string,
  userId: string,
  orderId: string,
  discount: number,
) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const promo = await client.query(
      `SELECT * FROM promo_codes WHERE id=$1 FOR UPDATE`, [promoId]
    );
    if (!promo.rows[0]) throw new Error("PROMO_INVALID");

    await client.query(
      `INSERT INTO promo_redemptions
       (promo_id,user_id,order_id,discount_amount)
       VALUES ($1,$2,$3,$4)`,
      [promoId, userId, orderId, discount],
    );

    await client.query(
      `UPDATE promo_codes SET used_count=used_count+1 WHERE id=$1`,
      [promoId],
    );

    await client.query("COMMIT");
    return { ok: true };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

/** Integer-cent discount for a promo row (NUMERIC columns arrive as strings). Never exceeds the subtotal. */
export function computeDiscountCents(
  promo: { discount_type: string; discount_value: string | number; max_discount: string | number | null },
  subtotalCents: number,
): number {
  let cents =
    promo.discount_type === "PERCENT"
      ? Math.floor((subtotalCents * Number(promo.discount_value)) / 100)
      : Math.round(Number(promo.discount_value) * 100);
  if (promo.max_discount != null) cents = Math.min(cents, Math.round(Number(promo.max_discount) * 100));
  return Math.max(0, Math.min(cents, subtotalCents));
}

/**
 * Re-validates a promo against the real subtotal and records the redemption. It must run inside the
 * order-creation transaction: the promo row is locked, so usage limits and one-use-per-customer hold
 * under concurrency, and a failed order insert rolls the redemption back.
 */
export async function redeemPromoForOrder(
  client: PoolClient,
  code: string,
  userId: string,
  orderId: string,
  subtotalCents: number,
): Promise<number> {
  const found = await client.query(
    `SELECT * FROM promo_codes
     WHERE code=$1 AND active=true AND starts_at <= now()
       AND (expires_at IS NULL OR expires_at >= now())
     FOR UPDATE`,
    [code.trim().toUpperCase()],
  );
  const promo = found.rows[0];
  if (!promo) throw new Error("PROMO_INVALID");
  if (Math.round(Number(promo.min_order_total) * 100) > subtotalCents) throw new Error("PROMO_INVALID");
  if (promo.usage_limit != null && promo.used_count >= promo.usage_limit) throw new Error("PROMO_INVALID");

  const prior = await client.query(`SELECT 1 FROM promo_redemptions WHERE promo_id=$1 AND user_id=$2`, [promo.id, userId]);
  if (prior.rows[0]) throw new Error("PROMO_ALREADY_USED");

  const discountCents = computeDiscountCents(promo, subtotalCents);
  await client.query(
    `INSERT INTO promo_redemptions (promo_id,user_id,order_id,discount_amount) VALUES ($1,$2,$3,$4)`,
    [promo.id, userId, orderId, (discountCents / 100).toFixed(2)],
  );
  await client.query(`UPDATE promo_codes SET used_count=used_count+1 WHERE id=$1`, [promo.id]);
  return discountCents;
}

/** Gives a promo use back when its order is cancelled. Safe to call for orders without a promo. */
export async function releasePromoForOrder(client: PoolClient, orderId: string): Promise<void> {
  const released = await client.query(`DELETE FROM promo_redemptions WHERE order_id=$1 RETURNING promo_id`, [orderId]);
  if (released.rows[0]) {
    await client.query(`UPDATE promo_codes SET used_count=GREATEST(used_count-1,0) WHERE id=$1`, [released.rows[0].promo_id]);
  }
}
