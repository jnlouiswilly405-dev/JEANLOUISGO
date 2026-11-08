import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SessionProvider } from '@multigo/app-shell';
import { App } from './App.js';

const user = { id: 'owner-1', email: 'm@x.co', displayName: 'Mia', role: 'MERCHANT' };
const merchant = { id: 'm1', name: 'Pizza Place', owner_user_id: 'owner-1', active: true, created_at: '2026-01-01T00:00:00Z' };
const otherMerchant = { id: 'm2', name: 'Someone Else', owner_user_id: 'x', active: true, created_at: '2026-01-01T00:00:00Z' };
const mkOrder = (id: string, status: string) => ({ id, customerId: 'c', merchantId: 'm1', items: [], subtotalCents: 1000, deliveryFeeCents: 200, totalCents: 1200, currency: 'USD', status, createdAt: '2026-01-01T00:00:00Z' });
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

function fakeApi(state: { orders?: unknown[]; merchants?: unknown[]; handlers?: Record<string, (body: any) => Response> } = {}) {
  const calls: { method: string; path: string; body?: any }[] = [];
  const impl = vi.fn(async (url: string, init: RequestInit = {}) => {
    const path = new URL(url).pathname;
    const method = init.method ?? 'GET';
    const body = init.body ? JSON.parse(init.body as string) : undefined;
    calls.push({ method, path, body });
    const key = `${method} ${path}`;
    if (state.handlers?.[key]) return state.handlers[key](body);
    if (key === 'POST /api/auth/login') return json(200, { user, token: 'tok' });
    if (key === 'GET /api/orders') return json(200, state.orders ?? []);
    if (key === 'GET /api/merchants') return json(200, state.merchants ?? [merchant, otherMerchant]);
    if (key === 'GET /api/catalog/merchant/m1') return json(200, []);
    return json(404, { error: `no route ${key}` });
  });
  return { impl: impl as unknown as typeof fetch, calls };
}

function mount(fetchImpl: typeof fetch) {
  const store = new Map<string, string>();
  const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
  render(<SessionProvider apiBaseUrl="http://api.test" allowedRoles={['MERCHANT']} storage={storage} fetchImpl={fetchImpl}><App /></SessionProvider>);
}

async function signIn() {
  await userEvent.type(screen.getByLabelText('Email'), 'm@x.co');
  await userEvent.type(screen.getByLabelText('Password'), 'password123');
  await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
}

describe('merchant app', () => {
  it('offers only the valid next action per status and none for others', async () => {
    mount(fakeApi({ orders: [mkOrder('aaaaaaaa-1', 'PAID'), mkOrder('bbbbbbbb-2', 'ACCEPTED'), mkOrder('cccccccc-3', 'PREPARING'), mkOrder('dddddddd-4', 'READY'), mkOrder('eeeeeeee-5', 'PENDING_PAYMENT')] }).impl);
    await signIn();
    const items = await screen.findAllByRole('listitem');
    const labels = items.map((li) => within(li).queryByRole('button')?.textContent ?? null);
    expect(labels).toEqual(['Accept', 'Start preparing', 'Mark ready', null, null]);
  });

  it('sends the status transition and reloads the list', async () => {
    const api = fakeApi({ orders: [mkOrder('aaaaaaaa-1', 'PAID')], handlers: { 'POST /api/orders/aaaaaaaa-1/status': () => json(200, mkOrder('aaaaaaaa-1', 'ACCEPTED')) } });
    mount(api.impl);
    await signIn();
    await userEvent.click(await screen.findByRole('button', { name: 'Accept' }));
    await vi.waitFor(() => expect(api.calls.filter((c) => c.path === '/api/orders' && c.method === 'GET').length).toBeGreaterThan(1));
    expect(api.calls.find((c) => c.method === 'POST' && c.path.endsWith('/status'))?.body).toEqual({ status: 'ACCEPTED' });
  });

  it('shows the backend error when a transition is refused', async () => {
    const api = fakeApi({ orders: [mkOrder('aaaaaaaa-1', 'PAID')], handlers: { 'POST /api/orders/aaaaaaaa-1/status': () => json(403, { error: 'ORDER_FORBIDDEN' }) } });
    mount(api.impl);
    await signIn();
    await userEvent.click(await screen.findByRole('button', { name: 'Accept' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('ORDER_FORBIDDEN');
  });

  it('manages only the merchant\'s own restaurant and adds a product in cents', async () => {
    const api = fakeApi({ handlers: { 'POST /api/catalog': (b) => json(201, { id: 'p9', merchant_id: 'm1', name: b.name, description: null, price_cents: b.priceCents, active: true }) } });
    mount(api.impl);
    await signIn();
    await userEvent.click(screen.getByRole('button', { name: 'Menu' }));
    expect(await screen.findByRole('heading', { name: 'Pizza Place' })).toBeInTheDocument();
    expect(screen.queryByText('Someone Else')).not.toBeInTheDocument();
    const form = screen.getByRole('form', { name: 'Add menu item' });
    await userEvent.type(within(form).getByLabelText('Item name'), 'Calzone');
    await userEvent.type(within(form).getByLabelText('Price (USD)'), '9.5');
    await userEvent.click(within(form).getByRole('button', { name: 'Add item' }));
    await vi.waitFor(() => expect(api.calls.find((c) => c.path === '/api/catalog')?.body).toEqual({ merchantId: 'm1', name: 'Calzone', priceCents: 950 }));
  });

  it('rejects an invalid price without calling the API', async () => {
    const api = fakeApi();
    mount(api.impl);
    await signIn();
    await userEvent.click(screen.getByRole('button', { name: 'Menu' }));
    const form = await screen.findByRole('form', { name: 'Add menu item' });
    await userEvent.type(within(form).getByLabelText('Item name'), 'Calzone');
    await userEvent.type(within(form).getByLabelText('Price (USD)'), '9.999');
    await userEvent.click(within(form).getByRole('button', { name: 'Add item' }));
    expect(await within(form).findByRole('alert')).toHaveTextContent('valid price');
    expect(api.calls.some((c) => c.path === '/api/catalog' && c.method === 'POST')).toBe(false);
  });

  it('settlements: read-only view for the merchant\'s own restaurant only, with GET requests', async () => {
    const row = { id: 's1', merchant_id: 'm1', order_id: 'abcdef12-0000', status: 'ELIGIBLE', created_at: '2026-01-01T00:00:00Z', net_amount: '9.00', net_amount_cents: '875' };
    const api = fakeApi({ handlers: { 'GET /api/merchants/m1/settlements': () => json(200, [row]) } });
    mount(api.impl);
    await signIn();
    await userEvent.click(screen.getByRole('button', { name: 'Settlements' }));
    expect(await screen.findByText(/\$8\.75/)).toBeInTheDocument();
    expect(screen.getByText(/Payouts are not enabled/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /pay|approve|payout/i })).not.toBeInTheDocument();
    expect(api.calls.some((c) => c.path === '/api/merchants/m2/settlements')).toBe(false);
    expect(api.calls.filter((c) => c.path.includes('settlements')).every((c) => c.method === 'GET')).toBe(true);
  });

  it('settlements: empty state and backend errors are shown', async () => {
    const api = fakeApi({ handlers: { 'GET /api/merchants/m1/settlements': () => json(403, { error: 'Merchant access denied' }) } });
    mount(api.impl);
    await signIn();
    await userEvent.click(screen.getByRole('button', { name: 'Settlements' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Merchant access denied');
  });

  it('notifications tab lists the merchant\'s notifications', async () => {
    const api = fakeApi({ handlers: { 'GET /api/notifications': () => json(200, [{ id: 'n1', event_type: 'X', title: 'New order', body: 'b', order_id: null, read_at: null, created_at: '2026-01-01T00:00:00Z' }]) } });
    mount(api.impl);
    await signIn();
    await userEvent.click(screen.getByRole('button', { name: 'Notifications' }));
    expect(await screen.findByText('New order')).toBeInTheDocument();
  });

  it('offers to create a restaurant when the merchant has none', async () => {
    const api = fakeApi({ merchants: [otherMerchant], handlers: { 'POST /api/merchants': (b) => json(201, { ...merchant, name: b.name }) } });
    mount(api.impl);
    await signIn();
    await userEvent.click(screen.getByRole('button', { name: 'Menu' }));
    const form = await screen.findByRole('form', { name: 'Create restaurant' });
    await userEvent.type(within(form).getByLabelText('Restaurant name'), 'New Place');
    await userEvent.click(within(form).getByRole('button', { name: 'Create restaurant' }));
    await vi.waitFor(() => expect(api.calls.find((c) => c.method === 'POST' && c.path === '/api/merchants')?.body).toEqual({ name: 'New Place' }));
  });
});
