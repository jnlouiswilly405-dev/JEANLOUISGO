import type { PaymentProvider } from './payment.types.js';
import { createStripeSandboxProvider, readStripeSandboxConfig, type StripePaymentProvider } from './stripe-provider.js';

export interface PaymentIntentResult {
  provider: PaymentProvider;
  providerReference: string;
  status: 'PENDING' | 'SUCCEEDED' | 'FAILED';
  clientSecret?: string;
}

export interface PaymentProviderAdapter {
  createPayment(input: { paymentId: string; amountCents: number; currency: string; orderId: string; idempotencyKey?: string }): Promise<PaymentIntentResult>;
  verifyWebhook(rawBody: string, signature: string): boolean;
}

/** Test/development adapter only. Never represents a real payment processor. */
export class MockPaymentProvider implements PaymentProviderAdapter {
  async createPayment(input: { paymentId: string; amountCents: number; currency: string; orderId: string }): Promise<PaymentIntentResult> {
    return { provider: 'mock', providerReference: `mock_${input.paymentId}`, status: 'SUCCEEDED' };
  }
  verifyWebhook(_rawBody: string, _signature: string): boolean { return true; }
}

export function assertPaymentProviderAllowed(provider: PaymentProvider, nodeEnv = process.env.NODE_ENV): void {
  if (provider === 'mock' && nodeEnv !== 'test' && nodeEnv !== 'development') {
    throw new Error('Mock payments are disabled outside test/development environments');
  }
}

/**
 * Stripe is available only in sandbox mode: it requires a Stripe TEST secret key plus a webhook
 * secret. Without them (the default) it stays disabled; live keys are rejected outright.
 * Real-money processing, Connect transfers and payouts are not implemented.
 */
export function getProvider(provider: PaymentProvider): PaymentProviderAdapter {
  assertPaymentProviderAllowed(provider);
  if (provider === 'mock') return new MockPaymentProvider();
  return getStripeProvider();
}

export function getStripeProvider(): StripePaymentProvider {
  const config = readStripeSandboxConfig();
  if (!config) throw new Error('PAYMENT_PROVIDER_NOT_IMPLEMENTED: live payment processing is disabled');
  return createStripeSandboxProvider(config);
}
