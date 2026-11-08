import { Pool } from "pg";

export async function createReview(
  pool: Pool,
  orderId: string,
  reviewerId: string,
  rating: number,
  body?: string,
  subjectUserId?: string,
  merchantId?: string,
) {
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    throw new Error("INVALID_RATING");
  }

  const order = await pool.query(
    `SELECT o.customer_id, o.status, o.merchant_id, m.owner_user_id AS merchant_owner_id,
            dp.user_id AS driver_profile_user_id, d.user_id AS legacy_driver_user_id
     FROM orders o
     LEFT JOIN merchants m ON m.id=o.merchant_id
     LEFT JOIN driver_profiles dp ON dp.id=o.driver_profile_id
     LEFT JOIN drivers d ON d.id=o.driver_id
     WHERE o.id=$1`,
    [orderId],
  );
  const o = order.rows[0];
  if (!o) throw new Error("ORDER_NOT_FOUND");
  if (o.customer_id !== reviewerId) throw new Error("REVIEW_FORBIDDEN");
  if (o.status !== "DELIVERED") throw new Error("ORDER_NOT_DELIVERED");
  if (merchantId && merchantId !== o.merchant_id) throw new Error("REVIEW_SUBJECT_INVALID");
  if (
    subjectUserId &&
    ![o.merchant_owner_id, o.driver_profile_user_id, o.legacy_driver_user_id].includes(subjectUserId)
  ) {
    throw new Error("REVIEW_SUBJECT_INVALID");
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO reviews
       (order_id, reviewer_id, subject_user_id, merchant_id, rating, body)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING *`,
      [orderId, reviewerId, subjectUserId ?? null, merchantId ?? null, rating, body ?? null],
    );
    return rows[0];
  } catch (e) {
    if ((e as { code?: string }).code === "23505") throw new Error("REVIEW_ALREADY_EXISTS");
    throw e;
  }
}

export async function listMerchantReviews(pool: Pool, merchantId: string) {
  const { rows } = await pool.query(
    `SELECT * FROM reviews WHERE merchant_id=$1 ORDER BY created_at DESC`,
    [merchantId],
  );
  return rows;
}

/** Public-facing view: rating, text and date only. Reviewer and subject identities are never returned. */
export async function listMerchantReviewsPage(pool: Pool, merchantId: string, q: { limit: number; offset: number }) {
  const [items, agg] = await Promise.all([
    pool.query(
      `SELECT id, rating, body, created_at FROM reviews WHERE merchant_id=$1 ORDER BY created_at DESC, id LIMIT $2 OFFSET $3`,
      [merchantId, q.limit, q.offset],
    ),
    pool.query(`SELECT count(*)::int AS n, avg(rating)::float AS avg FROM reviews WHERE merchant_id=$1`, [merchantId]),
  ]);
  return {
    average: agg.rows[0].avg === null ? null : Math.round(agg.rows[0].avg * 10) / 10,
    count: agg.rows[0].n as number,
    limit: q.limit,
    offset: q.offset,
    items: items.rows.map((r) => ({ id: r.id, rating: r.rating, body: r.body, createdAt: new Date(r.created_at).toISOString() })),
  };
}
