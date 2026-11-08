import { z } from 'zod';

// Response schemas mirror what the V45 backend actually returns (see backend/src/modules/**).
// Unknown extra fields are tolerated so additive backend changes do not break clients.

export const roleSchema = z.enum(['CUSTOMER', 'DRIVER', 'MERCHANT', 'ADMIN']);
export type UserRole = z.infer<typeof roleSchema>;

export const userSchema = z.object({ id: z.string(), email: z.string(), displayName: z.string(), role: roleSchema });
export type User = z.infer<typeof userSchema>;

export const authResultSchema = z.object({ user: userSchema, token: z.string().min(1) });
export type AuthResult = z.infer<typeof authResultSchema>;
export const meSchema = z.object({ user: userSchema });

export const orderStatusSchema = z.enum([
  'PENDING_PAYMENT', 'PAID', 'ACCEPTED', 'PREPARING', 'READY', 'ASSIGNED',
  'PICKED_UP', 'IN_TRANSIT', 'DELIVERED', 'CANCELLED', 'REFUNDED',
]);
export type OrderStatus = z.infer<typeof orderStatusSchema>;

export const orderItemSchema = z.object({
  productId: z.string(), name: z.string(), quantity: z.number(), unitPriceCents: z.number(),
});
export const orderSchema = z.object({
  id: z.string(),
  customerId: z.string(),
  merchantId: z.string(),
  driverId: z.string().optional(),
  items: z.array(orderItemSchema),
  subtotalCents: z.number(),
  deliveryFeeCents: z.number(),
  totalCents: z.number(),
  // Derived by the backend (subtotal + delivery - total); absent on older servers.
  discountCents: z.number().optional(),
  currency: z.string(),
  status: orderStatusSchema,
  createdAt: z.string(),
});
export type Order = z.infer<typeof orderSchema>;

export const merchantSchema = z.object({ id: z.string(), name: z.string(), owner_user_id: z.string().nullable().optional(), active: z.boolean(), created_at: z.string() });
export type Merchant = z.infer<typeof merchantSchema>;

export const productSchema = z.object({
  id: z.string(), merchant_id: z.string(), name: z.string(),
  description: z.string().nullable(), price_cents: z.number(), active: z.boolean(),
});
export type Product = z.infer<typeof productSchema>;

// Payments are returned as the stored row; `clientSecret` is present only for Stripe (sandbox) intents.
export const paymentSchema = z.object({
  id: z.string(), order_id: z.string(), provider: z.enum(['mock', 'stripe']),
  status: z.enum(['PENDING', 'SUCCEEDED', 'FAILED', 'REFUNDED']),
  amount_cents: z.number(), clientSecret: z.string().optional(),
});
export type Payment = z.infer<typeof paymentSchema>;

export const looseRowSchema = z.object({}).passthrough();
export const looseRowsSchema = z.array(looseRowSchema);

// NUMERIC columns reach the client as strings, hence the coercion.
export const trackingEventSchema = z.object({
  lat: z.coerce.number(), lng: z.coerce.number(), recorded_at: z.string(),
  order_id: z.string().nullable().optional(), driver_id: z.string().optional(),
}).passthrough();
export type TrackingEvent = z.infer<typeof trackingEventSchema>;

export const blockedOutboxSchema = z.object({
  items: z.array(z.object({
    id: z.string(), eventType: z.string(), aggregateType: z.string(), aggregateId: z.string(),
    status: z.string(), attempts: z.number(), createdAt: z.string(),
    availableAt: z.string().nullable().optional(), processedAt: z.string().nullable().optional(),
    failureReason: z.string().nullable(),
  })),
  total: z.number(), limit: z.number(), offset: z.number(),
});
export type BlockedOutboxPage = z.infer<typeof blockedOutboxSchema>;

export const unreferencedPaymentsSchema = z.object({
  items: z.array(z.object({
    paymentId: z.string(), orderId: z.string(), amountCents: z.number(), currency: z.string(),
    createdAt: z.string(), ageMinutes: z.number(),
  })),
  total: z.number(), limit: z.number(), offset: z.number(), olderThanMinutes: z.number(),
});
export type UnreferencedPaymentsPage = z.infer<typeof unreferencedPaymentsSchema>;

export const healthSchema = z.object({ database: z.string(), latencyMs: z.number(), checkedAt: z.string() });
export type SystemHealth = z.infer<typeof healthSchema>;

// pg returns NUMERIC/BIGINT as strings; `data` is free-form JSON written by the backend.
export const notificationSchema = z.object({
  id: z.string(), event_type: z.string(), title: z.string(), body: z.string(),
  order_id: z.string().nullable().optional(), read_at: z.string().nullable(), created_at: z.string(),
}).passthrough();
export type AppNotification = z.infer<typeof notificationSchema>;
export const notificationsSchema = z.array(notificationSchema);

// Promo amounts are NUMERIC(12,2) in major currency units (not cents like the rest of the API).
export const promoPreviewSchema = z.object({ promoId: z.string(), code: z.string(), discount: z.number() });
export type PromoPreview = z.infer<typeof promoPreviewSchema>;

// Read-only payout-side rows. Both the legacy NUMERIC columns and the *_cents BIGINT columns (migration 014) may be present.
const amountText = z.string().nullable().optional();
export const earningSchema = z.object({
  id: z.string(), order_id: z.string(), status: z.string(), created_at: z.string(),
  net_amount: amountText, net_amount_cents: amountText,
}).passthrough();
export type DriverEarning = z.infer<typeof earningSchema>;
export const settlementSchema = z.object({
  id: z.string(), order_id: z.string(), status: z.string(), created_at: z.string(),
  net_amount: amountText, net_amount_cents: amountText,
}).passthrough();
export type MerchantSettlement = z.infer<typeof settlementSchema>;

export const chatThreadSchema = z.object({
  id: z.string(), order_id: z.string().nullable(), created_at: z.string(), closed_at: z.string().nullable().optional(),
}).passthrough();
export type ChatThread = z.infer<typeof chatThreadSchema>;
export const chatThreadsSchema = z.array(chatThreadSchema);

export const chatMessageSchema = z.object({
  id: z.string(), thread_id: z.string(), sender_id: z.string(), body: z.string(), created_at: z.string(),
}).passthrough();
export type ChatMessage = z.infer<typeof chatMessageSchema>;
export const chatMessagesSchema = z.array(chatMessageSchema);
