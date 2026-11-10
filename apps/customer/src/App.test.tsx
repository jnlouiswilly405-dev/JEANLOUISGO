import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SessionProvider } from '@multigo/app-shell';
import { App } from './App.js';

const user = { id: 'u1', email: 'c@x.co', displayName: 'Cleo', role: 'CUSTOMER' };
const merchant = { id: 'm1', name: 'Pizza Place', owner_user_id: 'o1', active: true, created_at: '2026-01-01T00:00:00Z' };
const product = { id: 'p1', merchant_id: 'm1', name: 'Margherita', description: null, price_cents: 1200, active: true };
const deliveryAddress = { line1: '1 Test Street', city: 'Spring Valley', stateCode: 'NY', postalCode: '10977' };
const order = {
  id: 'o-1', customerId: 'u1', merchantId: 'm1', items: [{ productId: 'p1', name: 'Margherita', quantity: 2, unitPriceCents: 1200 }],
  subtotalCents: 2400, deliveryFeeCents: 300, totalCents: 2700, currency: 'USD', status: 'PENDING_PAYMENT', createdAt: '2026-01-01T00:00:00Z', deliveryAddress,
};
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

function fakeApi(overrides: Record<string, () => Response> = {}) {
  const calls: { method: string; path: string; body?: unknown; auth?: string }[] = [];
  const impl = vi.fn(async (url: string, init: RequestInit = {}) => {
    const path = new URL(url).pathname;
    const method = init.method ?? 'GET';
    calls.push({ method, path, body: init.body ? JSON.parse(init.body as string) : undefined, auth: (init.headers as Record<string, string>)?.Authorization });
    const key = `${method} ${path}`;
    if (overrides[key]) return overrides[key]();
    const table: Record<string, unknown> = {
      'POST /api/auth/login': { user, token: 'tok' },
      'GET /api/merchants': [merchant],
      'GET /api/catalog/merchant/m1': [product],
      'GET /api/service-areas/eligibility': { eligible: true, areaName: 'Spring Valley' },
      'GET /api/merchants/m1/reviews': { average: 4, count: 1, limit: 5, offset: 0, items: [{ id: 'r1', rating: 4, body: 'Tasty', createdAt: '2026-01-01T00:00:00Z' }] },
      'POST /api/orders': order,
      'GET /api/orders': [order],
      'GET /api/orders/o-1': order,
      'GET /api/orders/o-1/tracking': [],
    };
    return key in table ? json(key === 'POST /api/orders' ? 201 : 200, table[key]) : json(404, { error: `no route ${key}` });
  });
  return { impl: impl as unknown as typeof fetch, calls };
}

function mount(fetchImpl: typeof fetch) {
  const store = new Map<string, string>();
  const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
  render(<SessionProvider apiBaseUrl="http://api.test" allowedRoles={['CUSTOMER']} storage={storage} fetchImpl={fetchImpl}><App /></SessionProvider>);
}

async function signIn() {
  await userEvent.type(screen.getByLabelText('Email'), 'c@x.co');
  await userEvent.type(screen.getByLabelText('Password'), 'password123');
  await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
}

async function checkDeliveryAddress() {
  await userEvent.type(screen.getByLabelText('Address line 1'), deliveryAddress.line1);
  await userEvent.type(screen.getByLabelText('City'), deliveryAddress.city);
  await userEvent.type(screen.getByLabelText('State (2-letter code)'), deliveryAddress.stateCode);
  await userEvent.type(screen.getByLabelText('ZIP code'), deliveryAddress.postalCode);
  await userEvent.click(screen.getByRole('button', { name: 'Check delivery area' }));
  expect(await screen.findByText('Delivery is available in this area.')).toBeInTheDocument();
}

describe('customer app', () => {
  it('signs in, orders from a menu and shows the order awaiting payment', async () => {
    const api = fakeApi();
    mount(api.impl);
    await signIn();
    await userEvent.click(await screen.findByRole('button', { name: 'View menu' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Add Margherita' }));
    await userEvent.click(screen.getByRole('button', { name: 'Increase Margherita' }));
    expect(screen.getByText('$24.00')).toBeInTheDocument();
    await checkDeliveryAddress();
    await userEvent.click(screen.getByRole('button', { name: 'Place order' }));

    const detail = await screen.findByRole('region', { name: 'Order details' });
    expect(await within(detail).findByText('Pending payment')).toBeInTheDocument();
    expect(within(detail).getByText(/1 Test Street, Spring Valley, NY 10977/)).toBeInTheDocument();
    expect(within(detail).getByText(/Total \$27.00/)).toBeInTheDocument();
    expect(within(detail).getByText(/Card payment is unavailable: a Stripe test publishable key/)).toBeInTheDocument();

    const post = api.calls.find((c) => c.method === 'POST' && c.path === '/api/orders')!;
    expect(post.body).toEqual({ merchantId: 'm1', items: [{ productId: 'p1', quantity: 2 }], deliveryAddress });
    expect(post.auth).toBe('Bearer tok');
  });

  it('sends a checked promo code with the order, and drops it when the code is edited', async () => {
    const api = fakeApi({
      'POST /api/promos/validate': () => json(200, { promoId: 'p', code: 'SAVE10', discount: 2.4 }),
      'POST /api/orders': () => json(201, { ...order, discountCents: 240, totalCents: 2460 }),
      'GET /api/orders/o-1': () => json(200, { ...order, discountCents: 240, totalCents: 2460 }),
    });
    mount(api.impl);
    await signIn();
    await userEvent.click(await screen.findByRole('button', { name: 'View menu' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Add Margherita' }));
    await userEvent.click(screen.getByRole('button', { name: 'Increase Margherita' }));
    await userEvent.type(screen.getByLabelText('Promo code'), 'SAVE10');
    await userEvent.click(screen.getByRole('button', { name: 'Check code' }));
    await screen.findByText(/Applied when you place the order/);
    await checkDeliveryAddress();
    await userEvent.click(screen.getByRole('button', { name: 'Place order' }));
    const detail = await screen.findByRole('region', { name: 'Order details' });
    expect(within(detail).getByText(/Discount −\$2.40/)).toBeInTheDocument();
    expect(api.calls.find((c) => c.method === 'POST' && c.path === '/api/orders')!.body).toEqual({ merchantId: 'm1', items: [{ productId: 'p1', quantity: 2 }], deliveryAddress, promoCode: 'SAVE10' });
  });

  it('does not send a promo code that was checked and then edited', async () => {
    const api = fakeApi({ 'POST /api/promos/validate': () => json(200, { promoId: 'p', code: 'SAVE10', discount: 2.4 }) });
    mount(api.impl);
    await signIn();
    await userEvent.click(await screen.findByRole('button', { name: 'View menu' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Add Margherita' }));
    await userEvent.type(screen.getByLabelText('Promo code'), 'SAVE10');
    await userEvent.click(screen.getByRole('button', { name: 'Check code' }));
    await screen.findByText(/Applied when you place the order/);
    await userEvent.type(screen.getByLabelText('Promo code'), 'X');
    await checkDeliveryAddress();
    await userEvent.click(screen.getByRole('button', { name: 'Place order' }));
    await screen.findByRole('region', { name: 'Order details' });
    expect(api.calls.find((c) => c.method === 'POST' && c.path === '/api/orders')!.body).not.toHaveProperty('promoCode');
  });

  it('explains a promo rejection when placing the order and keeps the cart', async () => {
    const api = fakeApi({
      'POST /api/promos/validate': () => json(200, { promoId: 'p', code: 'SAVE10', discount: 1 }),
      'POST /api/orders': () => json(400, { error: 'PROMO_ALREADY_USED' }),
    });
    mount(api.impl);
    await signIn();
    await userEvent.click(await screen.findByRole('button', { name: 'View menu' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Add Margherita' }));
    await userEvent.type(screen.getByLabelText('Promo code'), 'SAVE10');
    await userEvent.click(screen.getByRole('button', { name: 'Check code' }));
    await screen.findByText(/Applied when you place the order/);
    await checkDeliveryAddress();
    await userEvent.click(screen.getByRole('button', { name: 'Place order' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('You have already used this promo code');
    expect(screen.getByRole('list', { name: 'Cart' })).toHaveTextContent('Margherita');
  });

  it('shows the server error when an order is rejected and keeps the cart', async () => {
    const api = fakeApi({ 'POST /api/orders': () => json(409, { error: 'One or more products are unavailable' }) });
    mount(api.impl);
    await signIn();
    await userEvent.click(await screen.findByRole('button', { name: 'View menu' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Add Margherita' }));
    await checkDeliveryAddress();
    await userEvent.click(screen.getByRole('button', { name: 'Place order' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('One or more products are unavailable');
    expect(screen.getByRole('list', { name: 'Cart' })).toHaveTextContent('Margherita');
  });

  it('shows Coming Soon and blocks order submission outside active ZIP codes', async () => {
    const api = fakeApi({
      'GET /api/service-areas/eligibility': () => json(200, { eligible: false }),
    });
    mount(api.impl);
    await signIn();
    await userEvent.click(await screen.findByRole('button', { name: 'View menu' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Add Margherita' }));
    await userEvent.type(screen.getByLabelText('Address line 1'), deliveryAddress.line1);
    await userEvent.type(screen.getByLabelText('City'), deliveryAddress.city);
    await userEvent.type(screen.getByLabelText('State (2-letter code)'), 'NJ');
    await userEvent.type(screen.getByLabelText('ZIP code'), '07001');
    await userEvent.click(screen.getByRole('button', { name: 'Check delivery area' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Coming soon');
    expect(screen.getByRole('button', { name: 'Place order' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Check delivery area' }));
    expect(api.calls.some((call) => call.method === 'POST' && call.path === '/api/orders')).toBe(false);
  });

  it('lists past orders and opens their details', async () => {
    mount(fakeApi().impl);
    await signIn();
    await userEvent.click(await screen.findByRole('button', { name: 'My orders' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Details' }));
    expect(await screen.findByRole('region', { name: 'Order details' })).toHaveTextContent('2 × Margherita');
  });

  it('offers the review form only for delivered orders and opens notifications', async () => {
    const api = fakeApi({
      'GET /api/orders/o-1': () => json(200, { ...order, status: 'DELIVERED' }),
      'GET /api/notifications': () => json(200, [{ id: 'n1', event_type: 'X', title: 'Driver on the way', body: 'b', order_id: null, read_at: null, created_at: '2026-01-01T00:00:00Z' }]),
    });
    mount(api.impl);
    await signIn();
    await userEvent.click(await screen.findByRole('button', { name: 'My orders' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Details' }));
    expect(await screen.findByRole('form', { name: 'Rate this order' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Payment' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Notifications' }));
    expect(await screen.findByText('Driver on the way')).toBeInTheDocument();
  });

  it('opens order chat only on demand and only once the order is paid', async () => {
    const api = fakeApi({
      'GET /api/orders/o-1': () => json(200, { ...order, status: 'PAID' }),
      'POST /api/orders/o-1/chat': () => json(200, { id: 't1', order_id: 'o-1', created_at: '2026-01-01T00:00:00Z', closed_at: null }),
      'GET /api/chat/t1/messages': () => json(200, [{ id: 'm1', thread_id: 't1', sender_id: 'x', body: 'Hello from the kitchen', created_at: '2026-01-01T10:00:00Z' }]),
    });
    mount(api.impl);
    await signIn();
    await userEvent.click(await screen.findByRole('button', { name: 'My orders' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Details' }));
    await screen.findByRole('region', { name: 'Order details' });
    expect(api.calls.some((c) => c.path.endsWith('/chat'))).toBe(false);
    await userEvent.click(screen.getByRole('button', { name: 'Open chat' }));
    expect(await screen.findByText(/Hello from the kitchen/)).toBeInTheDocument();
  });

  it('does not offer chat for an unpaid order', async () => {
    mount(fakeApi().impl);
    await signIn();
    await userEvent.click(await screen.findByRole('button', { name: 'My orders' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Details' }));
    await screen.findByRole('region', { name: 'Order details' });
    expect(screen.queryByRole('button', { name: 'Open chat' })).not.toBeInTheDocument();
  });

  it('returns to the sign-in form after the session expires (401)', async () => {
    const api = fakeApi({ 'GET /api/merchants': () => json(401, { error: 'Invalid or expired token' }) });
    mount(api.impl);
    await signIn();
    expect(await screen.findByRole('form', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('shows public reviews on the restaurant menu', async () => {
    mount(fakeApi().impl);
    await signIn();
    await userEvent.click(await screen.findByRole('button', { name: 'View menu' }));
    expect(await screen.findByText('Tasty')).toBeInTheDocument();
    expect(screen.getByText(/Average rating: 4\.0/)).toBeInTheDocument();
  });
});
