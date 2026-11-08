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
