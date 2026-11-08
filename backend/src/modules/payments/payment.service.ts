import { randomUUID } from 'node:crypto';
import { pool } from '../../db/pool.js';
import type { PaymentProvider } from './payment.types.js';
import { getProvider } from './provider.js';

export async function createPayment(input: { orderId: string; provider: PaymentProvider; amountCents: number; idempotencyKey: string }, actor: { id: string; role: string }) {
  if (!pool) throw new Error('DATABASE_URL is not configured');
  const db = pool;
  const client = await db.connect();
  // Set when a processor call must happen AFTER the transaction has committed and its locks are released.
  let deferred: DeferredProviderCall | null = null;
  try {
    await client.query('BEGIN');
    // Serialize requests sharing an idempotency key, including the first insert.
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [input.idempotencyKey]);
    // Ownership is checked before the idempotency replay so a key cannot be used to read another customer's payment.
    const owner = await client.query<{ customer_id: string }>('SELECT customer_id FROM orders WHERE id=$1', [input.orderId]);
    if (!owner.rowCount) throw new Error('Order not found');
    assertPaymentOrderOwner(owner.rows[0].customer_id, actor);
    const existing = await client.query<{id:string;order_id:string;provider:string;amount_cents:number;status:string;provider_reference:string|null}>('SELECT id,order_id,provider,amount_cents,status,provider_reference FROM payments WHERE idempotency_key=$1 FOR UPDATE', [input.idempotencyKey]);
    if (existing.rowCount) {
      const prior = existing.rows[0];
      if (prior.order_id !== input.orderId || prior.provider !== input.provider || prior.amount_cents !== input.amountCents) {
        throw new Error('Idempotency key was already used for a different payment request');
      }
      // A processor call that never recorded its reference (crash or ambiguous network error) is resumed with the
      // same processor idempotency key, so the processor returns the original intent instead of creating another.
      if (prior.provider === 'stripe' && prior.status === 'PENDING' && !prior.provider_reference) {
        const currency = await client.query<{ currency: string }>('SELECT currency FROM orders WHERE id=$1', [input.orderId]);
        deferred = { paymentId: prior.id, orderId: input.orderId, amountCents: prior.amount_cents, currency: currency.rows[0].currency, idempotencyKey: input.idempotencyKey };
        await client.query('COMMIT');
      } else {
        await client.query('COMMIT');
        return prior;
      }
    }
    if (!deferred) {
    const order = await client.query<{ total_cents: number; status: string; currency: string }>('SELECT total_cents,status,currency FROM orders WHERE id=$1 FOR UPDATE', [input.orderId]);
    if (!order.rowCount) throw new Error('Order not found');
    if (order.rows[0].status !== 'PENDING_PAYMENT') throw new Error('Order is not payable');
    if (order.rows[0].total_cents !== input.amountCents) throw new Error('Payment amount does not match order total');
    // The order row lock serializes distinct idempotency keys for this order.
    // Do not create a second live processor attempt while one is already pending.
    const activePayment = await client.query<{ id: string; status: string }>(
      "SELECT id,status FROM payments WHERE order_id=$1 AND status IN ('PENDING','SUCCEEDED') ORDER BY created_at DESC LIMIT 1 FOR UPDATE",
      [input.orderId]
    );
    validateNoActivePayment(activePayment.rowCount ? activePayment.rows[0].status : null);
    const paymentId = randomUUID();
    // Availability check only (no network): fails before anything is written when the provider is disabled.
    const provider = getProvider(input.provider);
    if (input.provider === 'stripe') {
      // Record the attempt and release the order/payment locks BEFORE calling the processor over the network.
      await client.query(
        `INSERT INTO payments(id,order_id,provider,provider_reference,amount_cents,status,idempotency_key)
         VALUES($1,$2,$3,NULL,$4,'PENDING',$5)`,
        [paymentId,input.orderId,input.provider,input.amountCents,input.idempotencyKey]
      );
      await client.query('COMMIT');
      deferred = { paymentId, orderId: input.orderId, amountCents: input.amountCents, currency: order.rows[0].currency, idempotencyKey: input.idempotencyKey };
    } else {
    const providerResult = await provider.createPayment({ paymentId, amountCents: input.amountCents, currency: order.rows[0].currency, orderId: input.orderId, idempotencyKey: input.idempotencyKey });
    const payment = await client.query(
      `INSERT INTO payments(id,order_id,provider,provider_reference,amount_cents,status,idempotency_key)
       VALUES($1,$2,$3,$4,$5,$6,$7)
       RETURNING id,order_id,provider,provider_reference,amount_cents,status,created_at`,
      [paymentId,input.orderId,input.provider,providerResult.providerReference,input.amountCents,providerResult.status,input.idempotencyKey]
    );
    if (providerResult.status === 'SUCCEEDED') {
      await client.query("UPDATE orders SET status='PAID' WHERE id=$1", [input.orderId]);
      await client.query(`INSERT INTO ledger_entries(order_id,account_type,account_id,direction,amount_cents,currency) VALUES($1,'PLATFORM_CLEARING',NULL,'CREDIT',$2,$3)`, [input.orderId,input.amountCents,order.rows[0].currency]);
    }
    await client.query('COMMIT');
    return providerResult.clientSecret ? { ...payment.rows[0], clientSecret: providerResult.clientSecret } : payment.rows[0];
    }
    }
  } catch (e) { await client.query('ROLLBACK'); throw e; }
  finally { client.release(); }
  return completeStripePayment(db, deferred!);
}

type DeferredProviderCall = { paymentId: string; orderId: string; amountCents: number; currency: string; idempotencyKey: string };

/** Errors after which the processor definitely did not create an intent, so the attempt can be closed. */
export function isDefinitiveProviderError(error: unknown): boolean {
  const type = typeof error === 'object' && error !== null ? (error as { type?: unknown }).type : undefined;
  return type === 'StripeInvalidRequestError' || type === 'StripeAuthenticationError' || type === 'StripePermissionError' || type === 'StripeCardError';
}

/**
 * Runs the processor call with no database transaction or row lock held, then records the reference.
 * Definitive failures mark the attempt FAILED (the order can be retried with a new key); ambiguous failures
 * leave it PENDING so the same idempotency key resumes it safely.
 */
async function completeStripePayment(db: NonNullable<typeof pool>, call: DeferredProviderCall) {
  let result;
  try {
    result = await getProvider('stripe').createPayment({ paymentId: call.paymentId, amountCents: call.amountCents, currency: call.currency, orderId: call.orderId, idempotencyKey: call.idempotencyKey });
  } catch (e) {
    if (isDefinitiveProviderError(e)) {
      await db.query("UPDATE payments SET status='FAILED' WHERE id=$1 AND status='PENDING' AND provider_reference IS NULL", [call.paymentId]);
    }
    throw e;
  }
  await db.query("UPDATE payments SET provider_reference=$2 WHERE id=$1 AND status='PENDING' AND provider_reference IS NULL", [call.paymentId, result.providerReference]);
  const row = await db.query('SELECT id,order_id,provider,provider_reference,amount_cents,status,created_at FROM payments WHERE id=$1', [call.paymentId]);
  return result.clientSecret ? { ...row.rows[0], clientSecret: result.clientSecret } : row.rows[0];
}

export function assertPaymentOrderOwner(orderCustomerId: string, actor: { id: string; role: string }): void {
  if (actor.role !== 'ADMIN' && orderCustomerId !== actor.id) throw new Error('ORDER_FORBIDDEN');
}

export function validateNoActivePayment(existingStatus: string | null): void {
  if (existingStatus === 'PENDING' || existingStatus === 'SUCCEEDED') {
    throw new Error('PAYMENT_ATTEMPT_ALREADY_ACTIVE: reuse the original idempotency key for this order');
  }
}

export function validatePaymentWebhookEvent(type: string, status: 'SUCCEEDED'|'FAILED'): void {
  const expectedStatus = type === 'PAYMENT_SUCCEEDED' ? 'SUCCEEDED'
    : type === 'PAYMENT_FAILED' ? 'FAILED' : null;
  if (!expectedStatus || expectedStatus !== status) {
    throw new Error('WEBHOOK_EVENT_STATUS_MISMATCH: unsupported event type or inconsistent status');
  }
}

export function validatePaymentOrderState(status: string): void {
  if (status !== 'PENDING_PAYMENT' && status !== 'PAID') {
    throw new Error('WEBHOOK_ORDER_STATE_BLOCKED: payment cannot be finalized for this order state');
  }
}

export function validatePaymentWebhookDetails(input: { amountCents: number; currency: string; providerReference: string }, expected: { amountCents: number; currency: string; providerReference: string }): void {
  if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0) {
    throw new Error('WEBHOOK_AMOUNT_INVALID');
  }
  const currency = input.currency.trim().toUpperCase();
  const expectedCurrency = expected.currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency) || currency !== expectedCurrency) {
    throw new Error('WEBHOOK_CURRENCY_MISMATCH');
  }
  if (input.amountCents !== expected.amountCents) {
    throw new Error('WEBHOOK_AMOUNT_MISMATCH');
  }
  if (!input.providerReference || input.providerReference !== expected.providerReference) {
    throw new Error('WEBHOOK_PROVIDER_REFERENCE_MISMATCH');
  }
}

export async function handleWebhook(input: { provider: PaymentProvider; eventId: string; type: string; paymentId: string; status: 'SUCCEEDED'|'FAILED'; amountCents: number; currency: string; providerReference: string; rawBody: string; signature: string }) {
  if (!pool) throw new Error('DATABASE_URL is not configured');
  validatePaymentWebhookEvent(input.type, input.status);
  if (!getProvider(input.provider).verifyWebhook(input.rawBody, input.signature)) throw new Error('Invalid webhook signature');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Lock the payment and order rows BEFORE inserting the event: the event row's foreign key takes a shared lock on
    // the payment row, so inserting first made concurrent events for one payment deadlock on the later FOR UPDATE.
    const payment = await client.query<{ order_id:string; amount_cents:number; status:string; currency:string; provider_reference:string|null; order_status:string }>('SELECT p.order_id,p.amount_cents,p.status,o.currency,p.provider_reference,o.status AS order_status FROM payments p JOIN orders o ON o.id=p.order_id WHERE p.id=$1 AND p.provider=$2 FOR UPDATE OF p,o',[input.paymentId,input.provider]);
    if (!payment.rowCount) throw new Error('Payment not found');
    const inserted = await client.query(`INSERT INTO payment_events(event_id,provider,event_type,payment_id,payload) VALUES($1,$2,$3,$4,$5::jsonb) ON CONFLICT(provider,event_id) DO NOTHING RETURNING event_id`, [input.eventId,input.provider,input.type,input.paymentId,input.rawBody]);
    if (!inserted.rowCount) { await client.query('COMMIT'); return { duplicate: true }; }    // Early-arrival recovery: a verified SUCCEEDED Stripe event may supply the reference only for a PENDING stripe
    // payment that has none yet. Amount and currency are still compared below, and UNIQUE(provider_reference) plus the
    // IS NULL guard keep it single-use. Any failure rolls back the event insert too, so Stripe's retry is processed normally.
    const adoptReference = input.provider === 'stripe' && input.status === 'SUCCEEDED'
      && payment.rows[0].status === 'PENDING' && payment.rows[0].provider_reference === null
      && /^pi_[A-Za-z0-9_]+$/.test(input.providerReference);
    validatePaymentWebhookDetails(input, { amountCents: payment.rows[0].amount_cents, currency: payment.rows[0].currency, providerReference: adoptReference ? input.providerReference : payment.rows[0].provider_reference as string });
    if (adoptReference) {
      const adopted = await client.query("UPDATE payments SET provider_reference=$2 WHERE id=$1 AND status='PENDING' AND provider_reference IS NULL", [input.paymentId, input.providerReference]);
      if (adopted.rowCount !== 1) throw new Error('WEBHOOK_PROVIDER_REFERENCE_ADOPTION_FAILED');
    }
    if (input.status === 'SUCCEEDED') validatePaymentOrderState(payment.rows[0].order_status);
    if (input.status === 'SUCCEEDED' && payment.rows[0].status !== 'SUCCEEDED') {
      await client.query("UPDATE payments SET status='SUCCEEDED' WHERE id=$1",[input.paymentId]);
      await client.query("UPDATE orders SET status='PAID' WHERE id=$1 AND status='PENDING_PAYMENT'",[payment.rows[0].order_id]);
      await client.query(`INSERT INTO ledger_entries(order_id,account_type,account_id,direction,amount_cents,currency) SELECT p.order_id,'PLATFORM_CLEARING',NULL,'CREDIT',p.amount_cents,o.currency FROM payments p JOIN orders o ON o.id=p.order_id WHERE p.id=$1 AND NOT EXISTS (SELECT 1 FROM ledger_entries WHERE order_id=p.order_id AND account_type='PLATFORM_CLEARING' AND direction='CREDIT')`,[input.paymentId]);
    } else if (input.status === 'FAILED') {
      await client.query("UPDATE payments SET status='FAILED' WHERE id=$1 AND status <> 'SUCCEEDED'",[input.paymentId]);
    }
    await client.query('COMMIT');
    return { duplicate: false };
  } catch(e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
}

/**
 * Refunds are intentionally blocked until a live provider refund API,
 * provider-confirmed outcomes, and reconciliation are implemented.
 * Writing a local SUCCEEDED refund without processor confirmation would
 * create a false financial record.
 */
export async function refundPayment(_paymentId: string, _amountCents: number): Promise<never> {
  throw new Error('REFUND_PROVIDER_NOT_IMPLEMENTED: refunds are disabled until provider confirmation is available');
}
