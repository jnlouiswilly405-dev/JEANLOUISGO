import { afterEach, describe, expect, it } from 'vitest';
import { assertPaymentProviderAllowed, getProvider } from './provider.js';
import { refundPayment, validateNoActivePayment, validatePaymentOrderState, validatePaymentWebhookDetails, validatePaymentWebhookEvent } from './payment.service.js';

afterEach(() => {
  delete process.env.NODE_ENV;
});

describe('payment provider safety', () => {
  it('allows mock payments in test mode', () => {
    expect(() => assertPaymentProviderAllowed('mock', 'test')).not.toThrow();
    expect(getProvider('mock')).toBeDefined();
  });

  it('allows mock payments in local development', () => {
    expect(() => assertPaymentProviderAllowed('mock', 'development')).not.toThrow();
  });

  it('rejects mock payments in production', () => {
    expect(() => assertPaymentProviderAllowed('mock', 'production')).toThrow(/disabled/i);
  });

  it('rejects mock payments when the environment is unspecified', () => {
    expect(() => assertPaymentProviderAllowed('mock', undefined)).toThrow(/disabled/i);
  });

  it('fails closed for Stripe until an official adapter is implemented', () => {
    expect(() => getProvider('stripe')).toThrow('PAYMENT_PROVIDER_NOT_IMPLEMENTED');
  });
});


describe('refund safety', () => {
  it('fails closed instead of recording an unconfirmed refund', async () => {
    await expect(refundPayment('00000000-0000-4000-8000-000000000000', 500))
      .rejects.toThrow('REFUND_PROVIDER_NOT_IMPLEMENTED');
  });
});


describe('provider-scoped webhook idempotency', () => {
  it('uses the provider and event ID together as the conflict target', async () => {
    const source = await import('node:fs/promises').then((fs) => fs.readFile(
      new URL('./payment.service.ts', import.meta.url), 'utf8'
    ));
    expect(source).toContain('ON CONFLICT(provider,event_id) DO NOTHING');
    expect(source).not.toContain('ON CONFLICT(event_id) DO NOTHING');
  });
});


describe('webhook event integrity', () => {
  it('accepts only the supported success event and status pair', () => {
    expect(() => validatePaymentWebhookEvent('PAYMENT_SUCCEEDED', 'SUCCEEDED')).not.toThrow();
  });

  it('accepts only the supported failure event and status pair', () => {
    expect(() => validatePaymentWebhookEvent('PAYMENT_FAILED', 'FAILED')).not.toThrow();
  });

  it('rejects a success event carrying a failed status', () => {
    expect(() => validatePaymentWebhookEvent('PAYMENT_SUCCEEDED', 'FAILED')).toThrow('WEBHOOK_EVENT_STATUS_MISMATCH');
  });

  it('rejects unknown event types even when status looks valid', () => {
    expect(() => validatePaymentWebhookEvent('REFUND_SUCCEEDED', 'SUCCEEDED')).toThrow('WEBHOOK_EVENT_STATUS_MISMATCH');
  });
});


describe('webhook payment detail matching', () => {
  const expected = { amountCents: 2599, currency: 'USD', providerReference: 'provider_ref_123' };
  it('accepts an exact amount, currency, and provider reference match', () => {
    expect(() => validatePaymentWebhookDetails({ ...expected, currency: 'usd' }, expected)).not.toThrow();
  });
  it('rejects an amount that differs from the stored payment', () => {
    expect(() => validatePaymentWebhookDetails({ ...expected, amountCents: 2600 }, expected)).toThrow('WEBHOOK_AMOUNT_MISMATCH');
  });
  it('rejects a currency that differs from the order', () => {
    expect(() => validatePaymentWebhookDetails({ ...expected, currency: 'CAD' }, expected)).toThrow('WEBHOOK_CURRENCY_MISMATCH');
  });
  it('rejects a provider reference that differs from the created payment', () => {
    expect(() => validatePaymentWebhookDetails({ ...expected, providerReference: 'other_ref' }, expected)).toThrow('WEBHOOK_PROVIDER_REFERENCE_MISMATCH');
  });
  it('rejects unsafe or non-positive minor-unit amounts', () => {
    expect(() => validatePaymentWebhookDetails({ ...expected, amountCents: Number.MAX_SAFE_INTEGER + 1 }, expected)).toThrow('WEBHOOK_AMOUNT_INVALID');
    expect(() => validatePaymentWebhookDetails({ ...expected, amountCents: 0 }, expected)).toThrow('WEBHOOK_AMOUNT_INVALID');
  });
});


describe('webhook order-state gate', () => {
  it('allows payment finalization for pending-payment orders', () => {
    expect(() => validatePaymentOrderState('PENDING_PAYMENT')).not.toThrow();
  });
  it('allows idempotent confirmation for already-paid orders', () => {
    expect(() => validatePaymentOrderState('PAID')).not.toThrow();
  });
  it('blocks payment finalization for cancelled or otherwise closed orders', () => {
    expect(() => validatePaymentOrderState('CANCELLED')).toThrow('WEBHOOK_ORDER_STATE_BLOCKED');
    expect(() => validatePaymentOrderState('DELIVERED')).toThrow('WEBHOOK_ORDER_STATE_BLOCKED');
  });
});


describe('one active payment attempt per order', () => {
  it('allows a new attempt when no prior payment exists', () => {
    expect(() => validateNoActivePayment(null)).not.toThrow();
  });
  it('allows a retry after a prior attempt failed', () => {
    expect(() => validateNoActivePayment('FAILED')).not.toThrow();
  });
  it('blocks a second pending attempt under a different idempotency key', () => {
    expect(() => validateNoActivePayment('PENDING')).toThrow('PAYMENT_ATTEMPT_ALREADY_ACTIVE');
  });
  it('blocks a new attempt when a prior payment already succeeded', () => {
    expect(() => validateNoActivePayment('SUCCEEDED')).toThrow('PAYMENT_ATTEMPT_ALREADY_ACTIVE');
  });
});
