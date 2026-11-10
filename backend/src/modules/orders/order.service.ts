import { randomUUID } from 'node:crypto';
import { pool, query } from '../../db/pool.js';
import { notifyOrderStatus } from '../notifications/service.js';
import { redeemPromoForOrder, releasePromoForOrder } from '../promos/service.js';
import { requireActiveDeliveryArea } from '../service-areas/service.js';
import type { DeliveryAddress } from '../service-areas/types.js';
import type { Order, OrderItem, OrderStatus } from './order.types.js';

const transitions: Record<OrderStatus, OrderStatus[]> = {
  PENDING_PAYMENT:['PAID','CANCELLED'], PAID:['ACCEPTED','CANCELLED','REFUNDED'], ACCEPTED:['PREPARING','CANCELLED'], PREPARING:['READY','CANCELLED'], READY:['ASSIGNED'], ASSIGNED:['PICKED_UP','CANCELLED'], PICKED_UP:['IN_TRANSIT'], IN_TRANSIT:['DELIVERED'], DELIVERED:[], CANCELLED:[], REFUNDED:[]
};

export function assertValidOrderTransition(current: OrderStatus, next: OrderStatus): void {
  if (!transitions[current]?.includes(next)) {
    throw new Error(`Invalid transition ${current} -> ${next}`);
  }
}

type OrderItemInput = Pick<OrderItem, 'productId' | 'quantity'> & Partial<OrderItem>;

export function validateOrderInput(input: { items: OrderItemInput[]; deliveryFeeCents?: number }): void {
  if (!Array.isArray(input.items) || input.items.length === 0) throw new Error('Order must contain at least one item');
  if (input.items.some(item => !Number.isInteger(item.quantity) || item.quantity <= 0)) throw new Error('Item quantity must be a positive integer');
  if (input.items.some(item => !item.productId)) throw new Error('Each item must have a product ID');
  if (input.deliveryFeeCents !== undefined && (!Number.isSafeInteger(input.deliveryFeeCents) || input.deliveryFeeCents < 0)) throw new Error('Delivery fee must be a non-negative integer');
}

export async function createOrder(input:{customerId:string;merchantId:string;items:OrderItemInput[];deliveryAddress:DeliveryAddress;deliveryFeeCents?:number;promoCode?:string}):Promise<Order> {
  if (!pool) throw new Error('DATABASE_URL is not configured');
  validateOrderInput(input);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await requireActiveDeliveryArea(client, input.deliveryAddress);
    const productIds = input.items.map(i => i.productId);
    const products = await client.query<{id:string;name:string;price_cents:number}>('SELECT id,name,price_cents FROM products WHERE merchant_id=$1 AND active=true AND id=ANY($2::uuid[]) FOR SHARE', [input.merchantId, productIds]);
    const byId = new Map(products.rows.map(p => [p.id,p]));
    if (products.rowCount !== new Set(productIds).size) throw new Error('One or more products are unavailable');
    const normalized = input.items.map(i => {
      const p = byId.get(i.productId)!;
      return { productId:p.id, name:p.name, quantity:i.quantity, unitPriceCents:p.price_cents };
    });
    const subtotalCents = normalized.reduce((s,i)=>s+i.quantity*i.unitPriceCents,0);
    const deliveryFeeCents = input.deliveryFeeCents ?? 0;
    if (!Number.isSafeInteger(subtotalCents) || subtotalCents + deliveryFeeCents > 2147483647) {
      throw new Error('Order total exceeds the supported amount');
    }
    const id = randomUUID();
    const totalCents = subtotalCents + deliveryFeeCents;
    const orderResult = await client.query(
      `INSERT INTO orders(id,customer_id,merchant_id,status,subtotal_cents,delivery_fee_cents,total_cents,
                          delivery_address_line1,delivery_address_line2,delivery_city,delivery_state_code,delivery_postal_code)
       VALUES($1,$2,$3,'PENDING_PAYMENT',$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING id,customer_id,merchant_id,COALESCE(driver_profile_id, driver_id) AS driver_id,status,
                 subtotal_cents,delivery_fee_cents,total_cents,currency,created_at,
                 delivery_address_line1,delivery_address_line2,delivery_city,delivery_state_code,delivery_postal_code`,
      [id,input.customerId,input.merchantId,subtotalCents,deliveryFeeCents,totalCents,
        input.deliveryAddress.line1,input.deliveryAddress.line2 ?? null,input.deliveryAddress.city,
        input.deliveryAddress.stateCode,input.deliveryAddress.postalCode],
    );
    for (const item of normalized) await client.query('INSERT INTO order_items(order_id,product_id,name_snapshot,quantity,unit_price_cents) VALUES($1,$2,$3,$4,$5)', [id,item.productId,item.name,item.quantity,item.unitPriceCents]);
    let row = orderResult.rows[0];
    const promoCode = input.promoCode?.trim();
    if (promoCode) {
      // Same transaction as the order: the discount applies to the item subtotal only, never the delivery fee.
      const discountCents = await redeemPromoForOrder(client, promoCode, input.customerId, id, subtotalCents);
      if (totalCents - discountCents < 1) throw new Error('PROMO_NOT_APPLICABLE');
      row = (await client.query(
        `UPDATE orders SET total_cents=$2 WHERE id=$1
         RETURNING id,customer_id,merchant_id,COALESCE(driver_profile_id, driver_id) AS driver_id,status,
                   subtotal_cents,delivery_fee_cents,total_cents,currency,created_at,
                   delivery_address_line1,delivery_address_line2,delivery_city,delivery_state_code,delivery_postal_code`,
        [id, totalCents - discountCents],
      )).rows[0];
    }
    await client.query('COMMIT');
    return mapOrder(row, normalized, true);
  } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
}

export async function transitionOrder(id:string,next:OrderStatus):Promise<Order> {
  if (!pool) throw new Error('DATABASE_URL is not configured');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const current = await client.query<{status:OrderStatus}>('SELECT status FROM orders WHERE id=$1 FOR UPDATE',[id]);
    if (!current.rowCount) throw new Error('Order not found');
    assertValidOrderTransition(current.rows[0].status, next);
    const result = await client.query('UPDATE orders SET status=$2 WHERE id=$1 RETURNING id,customer_id,merchant_id,COALESCE(driver_profile_id, driver_id) AS driver_id,status,subtotal_cents,delivery_fee_cents,total_cents,currency,created_at',[id,next]);
    if (next === 'CANCELLED') await releasePromoForOrder(client, id);
    await client.query('COMMIT');
    return mapOrder(result.rows[0], []);
  } catch (e) { await client.query('ROLLBACK'); throw e; }
  finally { client.release(); }
}

export async function getOrder(id:string, includeDeliveryAddress = false):Promise<Order|undefined> {
  const addressColumns = includeDeliveryAddress
    ? ',delivery_address_line1,delivery_address_line2,delivery_city,delivery_state_code,delivery_postal_code'
    : '';
  const result = await query(
    `SELECT id,customer_id,merchant_id,COALESCE(driver_profile_id, driver_id) AS driver_id,
            status,subtotal_cents,delivery_fee_cents,total_cents,currency,created_at${addressColumns}
     FROM orders WHERE id=$1`,
    [id],
  );
  if (!result.rowCount) return undefined;
  const items = await query('SELECT product_id,name_snapshot,quantity,unit_price_cents FROM order_items WHERE order_id=$1 ORDER BY id',[id]);
  return mapOrder(
    result.rows[0],
    items.rows.map((i:any)=>({productId:i.product_id,name:i.name_snapshot,quantity:i.quantity,unitPriceCents:i.unit_price_cents})),
    includeDeliveryAddress,
  );
}

export async function listOrders(customerId?:string) {
  const result = customerId
    ? await query('SELECT id,customer_id,merchant_id,COALESCE(driver_profile_id, driver_id) AS driver_id,status,subtotal_cents,delivery_fee_cents,total_cents,currency,created_at FROM orders WHERE customer_id=$1 ORDER BY created_at DESC',[customerId])
    : await query('SELECT id,customer_id,merchant_id,COALESCE(driver_profile_id, driver_id) AS driver_id,status,subtotal_cents,delivery_fee_cents,total_cents,currency,created_at FROM orders ORDER BY created_at DESC');
  return result.rows.map(r=>mapOrder(r, []));
}

function mapOrder(row:any, items:any[], includeDeliveryAddress = false):Order {
  const deliveryAddress = includeDeliveryAddress && row.delivery_address_line1 ? {
    line1: row.delivery_address_line1,
    ...(row.delivery_address_line2 ? { line2: row.delivery_address_line2 } : {}),
    city: row.delivery_city,
    stateCode: row.delivery_state_code,
    postalCode: row.delivery_postal_code,
  } : undefined;
  return { id:row.id, customerId:row.customer_id, merchantId:row.merchant_id, driverId:row.driver_id ?? undefined, ...(deliveryAddress ? { deliveryAddress } : {}), items, subtotalCents:row.subtotal_cents, deliveryFeeCents:row.delivery_fee_cents, totalCents:row.total_cents, discountCents:row.subtotal_cents+row.delivery_fee_cents-row.total_cents, currency:'USD', status:row.status, createdAt:new Date(row.created_at).toISOString() };
}


/** Performs authorization and the order transition under one row lock to avoid TOCTOU races. */
export async function transitionOrderForActor(id: string, next: OrderStatus, actor: { id: string; role: string }): Promise<Order> {
  if (!pool) throw new Error('DATABASE_URL is not configured');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const selected = await client.query<{
      id: string; status: OrderStatus; merchant_owner_id: string | null;
      driver_profile_user_id: string | null; legacy_driver_user_id: string | null;
    }>(
      `SELECT o.id, o.status, m.owner_user_id AS merchant_owner_id,
              dp.user_id AS driver_profile_user_id, d.user_id AS legacy_driver_user_id
       FROM orders o
       LEFT JOIN merchants m ON m.id=o.merchant_id
       LEFT JOIN driver_profiles dp ON dp.id=o.driver_profile_id
       LEFT JOIN drivers d ON d.id=o.driver_id
       WHERE o.id=$1
       FOR UPDATE OF o`, [id]
    );
    if (!selected.rowCount) throw new Error('Order not found');
    const row = selected.rows[0];
    let allowed = actor.role === 'ADMIN';
    if (actor.role === 'MERCHANT' && ['ACCEPTED','PREPARING','READY'].includes(next)) {
      allowed = row.merchant_owner_id === actor.id;
    }
    if (actor.role === 'DRIVER' && ['PICKED_UP','IN_TRANSIT','DELIVERED'].includes(next)) {
      allowed = row.driver_profile_user_id === actor.id || row.legacy_driver_user_id === actor.id;
    }
    if (!allowed) throw new Error('ORDER_FORBIDDEN');
    assertValidOrderTransition(row.status, next);
    const updated = await client.query(
      `UPDATE orders SET status=$2 WHERE id=$1
       RETURNING id,customer_id,merchant_id,COALESCE(driver_profile_id,driver_id) AS driver_id,
                 status,subtotal_cents,delivery_fee_cents,total_cents,currency,created_at`, [id,next]
    );
    if (next === 'CANCELLED') await releasePromoForOrder(client, id);
    await notifyOrderStatus(client, id, next);
    await client.query('COMMIT');
    return mapOrder(updated.rows[0], []);
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

/** Lists only orders visible to the authenticated actor. */
export async function listOrdersForActor(actor: { id: string; role: string }) {
  if (!pool) throw new Error('DATABASE_URL is not configured');
  if (actor.role === 'ADMIN') return listOrders();
  const includeDeliveryAddress = actor.role === 'CUSTOMER' || actor.role === 'DRIVER';
  const addressColumns = includeDeliveryAddress
    ? ',o.delivery_address_line1,o.delivery_address_line2,o.delivery_city,o.delivery_state_code,o.delivery_postal_code'
    : '';
  const result = await query(
    `SELECT o.id,o.customer_id,o.merchant_id,
            COALESCE(o.driver_profile_id,o.driver_id) AS driver_id,
            o.status,o.subtotal_cents,o.delivery_fee_cents,o.total_cents,o.currency,o.created_at${addressColumns}
     FROM orders o
     LEFT JOIN merchants m ON m.id=o.merchant_id
     LEFT JOIN driver_profiles dp ON dp.id=o.driver_profile_id
     LEFT JOIN drivers d ON d.id=o.driver_id
     WHERE (o.customer_id=$1 AND $2='CUSTOMER')
        OR (m.owner_user_id=$1 AND $2='MERCHANT')
        OR (dp.user_id=$1 AND $2='DRIVER')
        OR (d.user_id=$1 AND $2='DRIVER')
     ORDER BY o.created_at DESC`, [actor.id, actor.role]
  );
  return result.rows.map(r => mapOrder(r, [], includeDeliveryAddress));
}

/** Checks visibility before returning a single order to a non-admin actor. */
export async function getOrderForActor(id: string, actor: { id: string; role: string }) {
  if (!pool) throw new Error('DATABASE_URL is not configured');
  if (actor.role === 'ADMIN') return getOrder(id);
  const allowed = await query(
    `SELECT 1 FROM orders o
     LEFT JOIN merchants m ON m.id=o.merchant_id
     LEFT JOIN driver_profiles dp ON dp.id=o.driver_profile_id
     LEFT JOIN drivers d ON d.id=o.driver_id
     WHERE o.id=$1 AND (
       (o.customer_id=$2 AND $3='CUSTOMER') OR
       (m.owner_user_id=$2 AND $3='MERCHANT') OR
       (dp.user_id=$2 AND $3='DRIVER') OR
       (d.user_id=$2 AND $3='DRIVER')
     )`, [id, actor.id, actor.role]
  );
  if (!allowed.rowCount) return undefined;
  return getOrder(id, actor.role === 'CUSTOMER' || actor.role === 'DRIVER');
}

export async function assertOrderStatusActor(id: string, next: OrderStatus, actor: { id: string; role: string }) {
  if (!pool) throw new Error('DATABASE_URL is not configured');
  if (actor.role === 'ADMIN') return;
  let allowed = false;
  if (actor.role === 'MERCHANT' && ['ACCEPTED','PREPARING','READY'].includes(next)) {
    const result = await query(
      `SELECT 1 FROM orders o JOIN merchants m ON m.id=o.merchant_id
       WHERE o.id=$1 AND m.owner_user_id=$2`, [id, actor.id]
    );
    allowed = !!result.rowCount;
  }
  if (actor.role === 'DRIVER' && ['PICKED_UP','IN_TRANSIT','DELIVERED'].includes(next)) {
    const result = await query(
      `SELECT 1 FROM orders o
       LEFT JOIN driver_profiles dp ON dp.id=o.driver_profile_id
       LEFT JOIN drivers d ON d.id=o.driver_id
       WHERE o.id=$1 AND (dp.user_id=$2 OR d.user_id=$2)`, [id, actor.id]
    );
    allowed = !!result.rowCount;
  }
  if (!allowed) throw new Error('ORDER_FORBIDDEN');
}
