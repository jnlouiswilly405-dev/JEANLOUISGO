import type { PaymentProvider } from './payment.types.js';

export interface PaymentIntentResult {
  provider: PaymentProvider;
  providerReference: string;
  status: 'PENDING' | 'SUCCEEDED' | 'FAILED';
}

export interface PaymentProviderAdapter {
  createPayment(input: { paymentId: string; amountCents: number; currency: string; orderId: string }): Promise<PaymentIntentResult>;
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
 * Live providers are deliberately unavailable until their official SDK,
 * raw-body signature verification, API calls, and reconciliation are implemented.
 * A generic HMAC check is not a substitute for Stripe's signed webhook protocol.
 */
export function getProvider(provider: PaymentProvider): PaymentProviderAdapter {
  assertPaymentProviderAllowed(provider);
  if (provider === 'mock') return new MockPaymentProvider();
  throw new Error('PAYMENT_PROVIDER_NOT_IMPLEMENTED: live payment processing is disabled');
}
