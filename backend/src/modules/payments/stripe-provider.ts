import Stripe from 'stripe';
import type { PaymentIntentResult, PaymentProviderAdapter } from './provider.js';

/** Minimal slice of the Stripe client used here, so tests can inject a fake. */
export interface StripeLikeClient {
  paymentIntents: {
    create(params: Record<string, unknown>, options?: { idempotencyKey?: string }): Promise<{ id: string; client_secret?: string | null }>;
    retrieve(id: string): Promise<{ id: string; amount: number; currency: string; status: string; metadata: Record<string, string>; client_secret: string | null }>;
  };
  refunds: { create(params: Record<string, unknown>, options?: { idempotencyKey?: string }): Promise<{ id: string; status?: string | null }> };
  webhooks: { constructEvent(payload: string | Buffer, header: string, secret: string): Stripe.Event };
}

export interface StripeSandboxConfig { secretKey: string; webhookSecret: string }

/**
 * Sandbox only. Returns null (provider stays disabled) unless a Stripe TEST secret key and a
 * webhook secret are configured. Live or restricted-live keys are refused outright.
 */
export function readStripeSandboxConfig(source: { STRIPE_SECRET_KEY?: string; STRIPE_WEBHOOK_SECRET?: string } = process.env): StripeSandboxConfig | null {
  const secretKey = source.STRIPE_SECRET_KEY?.trim();
  if (!secretKey) return null;
  if (/^(sk|rk)_live_/.test(secretKey)) throw new Error('STRIPE_LIVE_KEYS_FORBIDDEN: only Stripe test-mode keys are allowed');
  if (!/^sk_test_[A-Za-z0-9]+$/.test(secretKey)) throw new Error('STRIPE_SECRET_KEY_INVALID: a Stripe test-mode secret key (sk_test_...) is required');
  const webhookSecret = source.STRIPE_WEBHOOK_SECRET?.trim();
  if (!webhookSecret) return null;
  return { secretKey, webhookSecret };
}

export class StripePaymentProvider implements PaymentProviderAdapter {
  constructor(private readonly client: StripeLikeClient, private readonly webhookSecret: string) {}

  async createPayment(input: { paymentId: string; amountCents: number; currency: string; orderId: string; idempotencyKey?: string }): Promise<PaymentIntentResult> {
    const intent = await this.client.paymentIntents.create(
      {
        amount: input.amountCents,
        currency: input.currency.toLowerCase(),
        automatic_payment_methods: { enabled: true },
        metadata: { paymentId: input.paymentId, orderId: input.orderId },
      },
      { idempotencyKey: input.idempotencyKey ?? `payment-${input.paymentId}` },
    );
    // Always PENDING: only a verified webhook may mark the payment SUCCEEDED.
    return { provider: 'stripe', providerReference: intent.id, status: 'PENDING', clientSecret: intent.client_secret ?? undefined };
  }

  async recoverPayment(input: { paymentId: string; orderId: string; amountCents: number; currency: string; providerReference: string }): Promise<string> {
    const intent = await this.client.paymentIntents.retrieve(input.providerReference);
    if (intent.id !== input.providerReference || intent.amount !== input.amountCents ||
        intent.currency.toUpperCase() !== input.currency.trim().toUpperCase() ||
        intent.metadata.paymentId !== input.paymentId || intent.metadata.orderId !== input.orderId) {
      throw new Error('PAYMENT_INTENT_RECONCILIATION_REQUIRED');
    }
    if (!['requires_payment_method', 'requires_confirmation', 'requires_action'].includes(intent.status) || !intent.client_secret) {
      throw new Error('PAYMENT_INTENT_NOT_ACTIONABLE');
    }
    return intent.client_secret;
  }

  verifyWebhook(rawBody: string, signature: string): boolean {
    try {
      this.client.webhooks.constructEvent(rawBody, signature, this.webhookSecret);
      return true;
    } catch {
      return false;
    }
  }

  /** Verifies the signature and returns the event; throws on any signature problem. */
  constructEvent(rawBody: string | Buffer, signature: string): Stripe.Event {
    return this.client.webhooks.constructEvent(rawBody, signature, this.webhookSecret);
  }

  /** Provider-level refund call (sandbox). The service/route layer keeps refunds disabled. */
  async createRefund(input: { providerReference: string; amountCents: number; idempotencyKey: string }): Promise<{ refundId: string; status: string }> {
    const refund = await this.client.refunds.create(
      { payment_intent: input.providerReference, amount: input.amountCents },
      { idempotencyKey: input.idempotencyKey },
    );
    return { refundId: refund.id, status: refund.status ?? 'unknown' };
  }
}

export function createStripeSandboxProvider(config: StripeSandboxConfig): StripePaymentProvider {
  return new StripePaymentProvider(new Stripe(config.secretKey, { maxNetworkRetries: 2 }) as unknown as StripeLikeClient, config.webhookSecret);
}

export type StripeMappedWebhook = {
  eventId: string;
  type: 'PAYMENT_SUCCEEDED' | 'PAYMENT_FAILED';
  paymentId: string;
  status: 'SUCCEEDED' | 'FAILED';
  amountCents: number;
  currency: string;
  providerReference: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Derives our webhook fields from a signature-verified Stripe event. Returns null for events we ignore. */
export function mapStripeEvent(event: Stripe.Event): StripeMappedWebhook | null {
  if (event.type !== 'payment_intent.succeeded' && event.type !== 'payment_intent.payment_failed') return null;
  const intent = event.data.object as Stripe.PaymentIntent;
  const paymentId = intent.metadata?.paymentId;
  if (!paymentId || !UUID.test(paymentId)) throw new Error('WEBHOOK_PAYMENT_ID_MISSING');
  const succeeded = event.type === 'payment_intent.succeeded';
  return {
    eventId: event.id,
    type: succeeded ? 'PAYMENT_SUCCEEDED' : 'PAYMENT_FAILED',
    paymentId,
    status: succeeded ? 'SUCCEEDED' : 'FAILED',
    amountCents: succeeded ? intent.amount_received : intent.amount,
    currency: intent.currency.toUpperCase(),
    providerReference: intent.id,
  };
}
