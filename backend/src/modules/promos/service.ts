import { Pool } from "pg";

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
