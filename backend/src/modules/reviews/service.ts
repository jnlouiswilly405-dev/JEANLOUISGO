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

  const { rows } = await pool.query(
    `INSERT INTO reviews
     (order_id, reviewer_id, subject_user_id, merchant_id, rating, body)
     VALUES ($1,$2,$3,$4,$5,$6)
     RETURNING *`,
    [orderId, reviewerId, subjectUserId ?? null, merchantId ?? null, rating, body ?? null],
  );
  return rows[0];
}

export async function listMerchantReviews(pool: Pool, merchantId: string) {
  const { rows } = await pool.query(
    `SELECT * FROM reviews WHERE merchant_id=$1 ORDER BY created_at DESC`,
    [merchantId],
  );
  return rows;
}
