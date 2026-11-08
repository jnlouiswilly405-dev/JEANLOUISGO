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

export interface PromoInput {
  code: string;
  discountType: "PERCENT" | "FIXED";
  percent?: number;
  amountCents?: number;
  maxDiscountCents?: number | null;
  minOrderTotalCents?: number;
  usageLimit?: number | null;
  startsAt?: string;
  expiresAt?: string | null;
}

const centsToMajor = (c: number) => (c / 100).toFixed(2);

function mapPromo(r: any) {
  const percent = r.discount_type === "PERCENT";
  return {
    id: r.id,
    code: r.code,
    discountType: r.discount_type,
    ...(percent ? { percent: Number(r.discount_value) } : { amountCents: Math.round(Number(r.discount_value) * 100) }),
    maxDiscountCents: r.max_discount == null ? null : Math.round(Number(r.max_discount) * 100),
    minOrderTotalCents: Math.round(Number(r.min_order_total) * 100),
    usageLimit: r.usage_limit,
    usedCount: r.used_count,
    startsAt: new Date(r.starts_at).toISOString(),
    expiresAt: r.expires_at ? new Date(r.expires_at).toISOString() : null,
    active: r.active,
  };
}

/**
 * Admin-only creation. Amounts are accepted in cents and stored as NUMERIC major units (the existing column format).
 * Promotions are platform-funded by default; nothing here touches settlement, earnings or payouts.
 */
export async function createPromo(pool: Pool, actorId: string, input: PromoInput) {
  const value = input.discountType === "PERCENT" ? input.percent : input.amountCents === undefined ? undefined : input.amountCents / 100;
  if (value === undefined || value <= 0) throw new Error("PROMO_VALUE_REQUIRED");
  if (input.discountType === "PERCENT" && value > 100) throw new Error("PROMO_VALUE_INVALID");
  if (input.startsAt && input.expiresAt && new Date(input.expiresAt) <= new Date(input.startsAt)) throw new Error("PROMO_DATES_INVALID");
  try {
    const { rows } = await pool.query(
      `INSERT INTO promo_codes (code,discount_type,discount_value,max_discount,min_order_total,usage_limit,starts_at,expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7::timestamptz, now()),$8::timestamptz) RETURNING *`,
      [
        input.code.trim().toUpperCase(), input.discountType, value.toFixed(2),
        input.maxDiscountCents == null ? null : centsToMajor(input.maxDiscountCents),
        centsToMajor(input.minOrderTotalCents ?? 0), input.usageLimit ?? null,
        input.startsAt ?? null, input.expiresAt ?? null,
      ],
    );
    await pool.query(
      `INSERT INTO audit_events (actor_user_id, action, entity_type, entity_id, metadata) VALUES ($1,'PROMO_CREATED','PROMO',$2,$3)`,
      [actorId, rows[0].id, JSON.stringify({ code: rows[0].code })],
    );
    return mapPromo(rows[0]);
  } catch (e) {
    if ((e as { code?: string }).code === "23505") throw new Error("PROMO_CODE_EXISTS");
    throw e;
  }
}

export async function listPromos(pool: Pool, q: { limit: number; offset: number }) {
  const { rows } = await pool.query(
    `SELECT * FROM promo_codes ORDER BY starts_at DESC, code ASC LIMIT $1 OFFSET $2`, [q.limit, q.offset],
  );
  const total = await pool.query(`SELECT count(*)::int AS n FROM promo_codes`);
  return { items: rows.map(mapPromo), total: total.rows[0].n as number, limit: q.limit, offset: q.offset };
}

export async function setPromoActive(pool: Pool, actorId: string, id: string, active: boolean) {
  const { rows } = await pool.query(`UPDATE promo_codes SET active=$2 WHERE id=$1 RETURNING *`, [id, active]);
  if (!rows[0]) throw new Error("PROMO_NOT_FOUND");
  await pool.query(
    `INSERT INTO audit_events (actor_user_id, action, entity_type, entity_id, metadata) VALUES ($1,$2,'PROMO',$3,$4)`,
    [actorId, active ? "PROMO_ACTIVATED" : "PROMO_DEACTIVATED", id, JSON.stringify({ code: rows[0].code })],
  );
  return mapPromo(rows[0]);
}
