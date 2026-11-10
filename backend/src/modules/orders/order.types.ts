import type { DeliveryAddress } from '../service-areas/types.js';

export type OrderStatus = 'PENDING_PAYMENT'|'PAID'|'ACCEPTED'|'PREPARING'|'READY'|'ASSIGNED'|'PICKED_UP'|'IN_TRANSIT'|'DELIVERED'|'CANCELLED'|'REFUNDED';
export interface OrderItem { productId: string; name: string; quantity: number; unitPriceCents: number; }
export interface Order { id:string; customerId:string; merchantId:string; driverId?:string; deliveryAddress?: DeliveryAddress; items:OrderItem[]; subtotalCents:number; deliveryFeeCents:number; totalCents:number; discountCents:number; currency:'USD'; status:OrderStatus; createdAt:string; }
