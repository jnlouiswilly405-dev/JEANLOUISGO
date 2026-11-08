import type { ZodType } from 'zod';
import {
  authResultSchema, blockedOutboxSchema, healthSchema, looseRowSchema, looseRowsSchema, meSchema,
  merchantSchema, orderSchema, paymentSchema, productSchema, unreferencedPaymentsSchema,
  type OrderStatus,
} from './schemas.js';

export class ApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface ApiClientOptions {
  baseUrl: string;
  getToken?: () => string | null;
  onUnauthorized?: () => void;
  fetchImpl?: typeof fetch;
}

function errorMessage(body: unknown, status: number): string {
  const e = (body as { error?: unknown } | null)?.error;
  if (typeof e === 'string') return e;
  if (Array.isArray(e)) return e.map((i) => (i as { message?: string }).message ?? 'Invalid input').join('; ');
  return `Request failed (${status})`;
}

export function createApiClient(opts: ApiClientOptions) {
  const doFetch = opts.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const base = opts.baseUrl.replace(/\/+$/, '');

  async function request<T>(method: string, path: string, schema: ZodType<T>, body?: unknown, query?: Record<string, string | number | undefined>): Promise<T> {
    const qs = query ? Object.entries(query).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join('&') : '';
    const headers: Record<string, string> = { Accept: 'application/json' };
    const token = opts.getToken?.();
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    let res: Response;
    try {
      res = await doFetch(`${base}${path}${qs ? `?${qs}` : ''}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch {
      throw new ApiError(0, 'Network error');
    }
    const text = await res.text();
    let json: unknown = null;
    if (text) { try { json = JSON.parse(text); } catch { json = null; } }
    if (!res.ok) {
      if (res.status === 401) opts.onUnauthorized?.();
      throw new ApiError(res.status, errorMessage(json, res.status));
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) throw new ApiError(res.status, 'Unexpected response from server');
    return parsed.data;
  }

  const enc = encodeURIComponent;
  return {
    auth: {
      login: (email: string, password: string) => request('POST', '/api/auth/login', authResultSchema, { email, password }),
      register: (input: { email: string; displayName: string; password: string }) => request('POST', '/api/auth/register', authResultSchema, input),
      me: () => request('GET', '/api/auth/me', meSchema),
    },
    merchants: {
      list: () => request('GET', '/api/merchants', merchantSchema.array()),
      products: (merchantId: string) => request('GET', `/api/catalog/merchant/${enc(merchantId)}`, productSchema.array()),
      createProduct: (input: { merchantId: string; name: string; description?: string; priceCents: number }) => request('POST', '/api/catalog', productSchema, input),
    },
    orders: {
      list: () => request('GET', '/api/orders', orderSchema.array()),
      get: (id: string) => request('GET', `/api/orders/${enc(id)}`, orderSchema),
      create: (input: { merchantId: string; items: { productId: string; quantity: number }[]; deliveryFeeCents?: number }) => request('POST', '/api/orders', orderSchema, input),
      setStatus: (id: string, status: Exclude<OrderStatus, 'PENDING_PAYMENT'>) => request('POST', `/api/orders/${enc(id)}/status`, orderSchema, { status }),
      tracking: (orderId: string) => request('GET', `/api/orders/${enc(orderId)}/tracking`, looseRowSchema.or(looseRowsSchema)),
      advanceDelivery: (orderId: string, action: 'PICKED_UP' | 'DELIVERED') => request('POST', `/api/orders/${enc(orderId)}/delivery`, looseRowSchema, { action }),
    },
    payments: {
      create: (input: { orderId: string; provider: 'mock' | 'stripe'; amountCents: number; idempotencyKey: string }) => request('POST', '/api/payments', paymentSchema, input),
    },
    drivers: {
      sendLocation: (driverId: string, input: { lat: number; lng: number; orderId?: string; accuracyM?: number }) => request('POST', `/api/drivers/${enc(driverId)}/location`, looseRowSchema, input),
    },
    notifications: {
      list: () => request('GET', '/api/notifications', looseRowsSchema),
      markRead: (id: string) => request('POST', `/api/notifications/${enc(id)}/read`, looseRowSchema),
    },
    chat: {
      list: (threadId: string) => request('GET', `/api/chat/${enc(threadId)}/messages`, looseRowsSchema),
      send: (threadId: string, body: string) => request('POST', `/api/chat/${enc(threadId)}/messages`, looseRowSchema, { body }),
    },
    reviews: {
      create: (input: { orderId: string; rating: number; body?: string }) => request('POST', '/api/reviews', looseRowSchema, input),
    },
    admin: {
      health: () => request('GET', '/api/admin/health', healthSchema),
      financialSummary: () => request('GET', '/api/admin/financial-summary', looseRowsSchema),
      blockedOutbox: (q: { eventType?: string; aggregateId?: string; limit?: number; offset?: number } = {}) => request('GET', '/api/admin/outbox/blocked', blockedOutboxSchema, undefined, q),
      unreferencedPayments: (q: { olderThanMinutes?: number; limit?: number; offset?: number } = {}) => request('GET', '/api/admin/payments/unreferenced', unreferencedPaymentsSchema, undefined, q),
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
