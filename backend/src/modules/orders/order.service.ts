import { randomUUID } from 'node:crypto';
import { pool, query } from '../../db/pool.js';
import { notifyOrderStatus } from '../notifications/service.js';
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

export async function createOrder(input:{customerId:string;merchantId:string;items:OrderItemInput[];deliveryFeeCents?:number}):Promise<Order> {
  if (!pool) throw new Error('DATABASE_URL is not configured');
  validateOrderInput(input);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
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
    const totalCents = subtotalCents + deliveryFeeCents;
    if (!Number.isSafeInteger(subtotalCents) || !Number.isSafeInteger(totalCents) || totalCents > 2147483647) {
      throw new Error('Order total exceeds the supported amount');
    }
    const id = randomUUID();
    const orderResult = await client.query(`INSERT INTO orders(id,customer_id,merchant_id,status,subtotal_cents,delivery_fee_cents,total_cents) VALUES($1,$2,$3,'PENDING_PAYMENT',$4,$5,$6) RETURNING id,customer_id,merchant_id,COALESCE(driver_profile_id, driver_id) AS driver_id,status,subtotal_cents,delivery_fee_cents,total_cents,currency,created_at`, [id,input.customerId,input.merchantId,subtotalCents,deliveryFeeCents,totalCents]);
    for (const item of normalized) await client.query('INSERT INTO order_items(order_id,product_id,name_snapshot,quantity,unit_price_cents) VALUES($1,$2,$3,$4,$5)', [id,item.productId,item.name,item.quantity,item.unitPriceCents]);
    await client.query('COMMIT');
    return mapOrder(orderResult.rows[0], normalized);
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
    await client.query('COMMIT');
    return mapOrder(result.rows[0], []);
  } catch (e) { await client.query('ROLLBACK'); throw e; }
  finally { client.release(); }
}

export async function getOrder(id:string):Promise<Order|undefined> {
  const result = await query('SELECT id,customer_id,merchant_id,COALESCE(driver_profile_id, driver_id) AS driver_id,status,subtotal_cents,delivery_fee_cents,total_cents,currency,created_at FROM orders WHERE id=$1',[id]);
  if (!result.rowCount) return undefined;
  const items = await query('SELECT product_id,name_snapshot,quantity,unit_price_cents FROM order_items WHERE order_id=$1 ORDER BY id',[id]);
  return mapOrder(result.rows[0], items.rows.map((i:any)=>({productId:i.product_id,name:i.name_snapshot,quantity:i.quantity,unitPriceCents:i.unit_price_cents})));
}

export async function listOrders(customerId?:string) {
  const result = customerId
    ? await query('SELECT id,customer_id,merchant_id,COALESCE(driver_profile_id, driver_id) AS driver_id,status,subtotal_cents,delivery_fee_cents,total_cents,currency,created_at FROM orders WHERE customer_id=$1 ORDER BY created_at DESC',[customerId])
    : await query('SELECT id,customer_id,merchant_id,COALESCE(driver_profile_id, driver_id) AS driver_id,status,subtotal_cents,delivery_fee_cents,total_cents,currency,created_at FROM orders ORDER BY created_at DESC');
  return result.rows.map(r=>mapOrder(r, []));
}

function mapOrder(row:any, items:any[]):Order {
  return { id:row.id, customerId:row.customer_id, merchantId:row.merchant_id, driverId:row.driver_id ?? undefined, items, subtotalCents:row.subtotal_cents, deliveryFeeCents:row.delivery_fee_cents, totalCents:row.total_cents, currency:'USD', status:row.status, createdAt:new Date(row.created_at).toISOString() };
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
  const result = await query(
    `SELECT o.id,o.customer_id,o.merchant_id,
            COALESCE(o.driver_profile_id,o.driver_id) AS driver_id,
            o.status,o.subtotal_cents,o.delivery_fee_cents,o.total_cents,o.currency,o.created_at
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
  return result.rows.map(r => mapOrder(r, []));
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
  return getOrder(id);
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
