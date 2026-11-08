import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SessionProvider } from '@multigo/app-shell';
import { PaymentStep, isTestPublishableKey } from './pages/PaymentStep.js';

const user = { id: 'u1', email: 'c@x.co', displayName: 'Cleo', role: 'CUSTOMER' };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

function fakeApi(paymentBody: unknown = { id: 'pay-1', order_id: 'o-1', provider: 'stripe', status: 'PENDING', amount_cents: 2700, clientSecret: 'pi_test_secret_abc' }) {
  const calls: { method: string; path: string; body?: any }[] = [];
  const impl = vi.fn(async (url: string, init: RequestInit = {}) => {
    const path = new URL(url).pathname;
    const method = init.method ?? 'GET';
    calls.push({ method, path, body: init.body ? JSON.parse(init.body as string) : undefined });
    const key = `${method} ${path}`;
    if (key === 'POST /api/auth/login') return json(200, { user, token: 'tok' });
    if (key === 'POST /api/payments') return json(201, paymentBody);
    return json(404, { error: `no route ${key}` });
  });
  return { impl: impl as unknown as typeof fetch, calls };
}

function fakeStripe(confirmResult: unknown = {}) {
  const element = { mount: vi.fn(), destroy: vi.fn() };
  const elements = { create: vi.fn(() => element) };
  const stripe = { elements: vi.fn(() => elements), confirmPayment: vi.fn(async () => confirmResult) };
  return { stripe, elements, element, load: vi.fn(async () => stripe as never) };
}

async function mountStep(api: ReturnType<typeof fakeApi>, props: Partial<Parameters<typeof PaymentStep>[0]>) {
  const store = new Map<string, string>([['multigo.session', JSON.stringify({ token: 'tok', user })]]);
  const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
  const onSubmitted = vi.fn();
  render(
    <SessionProvider apiBaseUrl="http://api.test" allowedRoles={['CUSTOMER']} storage={storage} fetchImpl={api.impl}>
      <PaymentStep orderId="o-1" amountCents={2700} onSubmitted={onSubmitted} {...props} />
    </SessionProvider>,
  );
  return onSubmitted;
}

describe('isTestPublishableKey', () => {
  it('accepts only pk_test_ keys', () => {
    expect(isTestPublishableKey('pk_test_abc')).toBe(true);
    expect(isTestPublishableKey('pk_live_abc')).toBe(false);
    expect(isTestPublishableKey('sk_test_abc')).toBe(false);
    expect(isTestPublishableKey(undefined)).toBe(false);
  });
});

describe('PaymentStep (sandbox)', () => {
  it('refuses live and secret keys without calling the backend or loading Stripe', async () => {
    for (const key of ['pk_live_abc', 'sk_test_abc', undefined]) {
      const api = fakeApi();
      const s = fakeStripe();
      await mountStep(api, { publishableKey: key, loadStripeImpl: s.load });
      expect(await screen.findByText(/Card payment is unavailable/)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Pay by card' })).not.toBeInTheDocument();
      expect(api.calls.filter((c) => c.path === '/api/payments')).toHaveLength(0);
      expect(s.load).not.toHaveBeenCalled();
      document.body.innerHTML = '';
    }
  });

  it('creates a stripe payment for the order total, mounts the Payment Element and confirms', async () => {
    const api = fakeApi();
    const s = fakeStripe({});
    const onSubmitted = await mountStep(api, { publishableKey: 'pk_test_abc', loadStripeImpl: s.load });
    await userEvent.click(screen.getByRole('button', { name: 'Pay by card' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Confirm payment' }));

    const post = api.calls.find((c) => c.path === '/api/payments')!;
    expect(post.body).toMatchObject({ orderId: 'o-1', provider: 'stripe', amountCents: 2700 });
    expect(post.body.idempotencyKey).toMatch(/^order-o-1-/);
    expect(s.load).toHaveBeenCalledWith('pk_test_abc');
    expect(s.stripe.elements).toHaveBeenCalledWith({ clientSecret: 'pi_test_secret_abc' });
    expect(s.element.mount).toHaveBeenCalled();
    expect(s.stripe.confirmPayment).toHaveBeenCalledWith(expect.objectContaining({ redirect: 'if_required' }));
    expect(onSubmitted).toHaveBeenCalledTimes(1);
    // Never claims the order is paid; it waits for the backend's verified confirmation.
    expect(await screen.findByText(/Waiting for the server to confirm/)).toBeInTheDocument();
    expect(screen.queryByText(/PAID/)).not.toBeInTheDocument();
  });

  it('shows the processor error and does not report submission when confirmation fails', async () => {
    const api = fakeApi();
    const s = fakeStripe({ error: { message: 'Your card was declined.' } });
    const onSubmitted = await mountStep(api, { publishableKey: 'pk_test_abc', loadStripeImpl: s.load });
    await userEvent.click(screen.getByRole('button', { name: 'Pay by card' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Confirm payment' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Your card was declined.');
    expect(onSubmitted).not.toHaveBeenCalled();
  });

  it('fails closed when the server returns no client secret', async () => {
    const api = fakeApi({ id: 'pay-1', order_id: 'o-1', provider: 'stripe', status: 'PENDING', amount_cents: 2700 });
    const s = fakeStripe();
    await mountStep(api, { publishableKey: 'pk_test_abc', loadStripeImpl: s.load });
    await userEvent.click(screen.getByRole('button', { name: 'Pay by card' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/did not return a payment session/);
    expect(s.load).not.toHaveBeenCalled();
  });
});
