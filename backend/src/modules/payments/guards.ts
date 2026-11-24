import type { PoolClient } from 'pg';

export async function assertPaymentClearedForOrder(client: PoolClient, orderId: string): Promise<void> {
  const order = await client.query<{ total_cents: number; currency: string }>(
    'SELECT total_cents,currency FROM orders WHERE id=$1',
    [orderId],
  );
  if (!order.rowCount) throw new Error('ORDER_NOT_FOUND');
  const payments = await client.query<{ amount_cents: number; status: string }>(
    "SELECT amount_cents,status FROM payments WHERE order_id=$1 AND status='SUCCEEDED'",
    [orderId],
  );
  const credits = await client.query<{ amount_cents: number; currency: string }>(
    "SELECT amount_cents,currency FROM ledger_entries WHERE order_id=$1 AND account_type='PLATFORM_CLEARING' AND direction='CREDIT'",
    [orderId],
  );
  if (payments.rowCount !== 1 || credits.rowCount !== 1 ||
      payments.rows[0].amount_cents !== order.rows[0].total_cents ||
      credits.rows[0].amount_cents !== order.rows[0].total_cents ||
      credits.rows[0].currency.trim().toUpperCase() !== order.rows[0].currency.trim().toUpperCase()) {
    throw new Error('PAYMENT_LEDGER_RECONCILIATION_REQUIRED');
  }
}
