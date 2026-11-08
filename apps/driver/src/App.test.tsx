import { act, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SessionProvider } from '@multigo/app-shell';
import { App } from './App.js';
import { useLocationSharing, type GeoLike } from './useLocationSharing.js';

const user = { id: 'd-user', email: 'd@x.co', displayName: 'Dan', role: 'DRIVER' };
const mkOrder = (id: string, status: string) => ({ id, customerId: 'c', merchantId: 'm', driverId: 'profile-1', items: [], subtotalCents: 1000, deliveryFeeCents: 200, totalCents: 1200, currency: 'USD', status, createdAt: '2026-01-01T00:00:00Z' });
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

function fakeApi(orders: unknown[], handlers: Record<string, () => Response> = {}) {
  const calls: { method: string; path: string; body?: any }[] = [];
  const impl = vi.fn(async (url: string, init: RequestInit = {}) => {
    const path = new URL(url).pathname;
    const method = init.method ?? 'GET';
    calls.push({ method, path, body: init.body ? JSON.parse(init.body as string) : undefined });
    const key = `${method} ${path}`;
    if (handlers[key]) return handlers[key]();
    if (key === 'POST /api/auth/login') return json(200, { user, token: 'tok' });
    if (key === 'GET /api/orders') return json(200, orders);
    if (method === 'POST') return json(200, mkOrder('x', 'IN_TRANSIT'));
    return json(404, { error: `no route ${key}` });
  });
  return { impl: impl as unknown as typeof fetch, calls };
}

function fakeGeo() {
  let cb: ((p: { coords: { latitude: number; longitude: number; accuracy: number } }) => void) | null = null;
  const geo: GeoLike = { watchPosition: vi.fn((ok) => { cb = ok; return 7; }), clearWatch: vi.fn() };
  return { geo, emit: (lat: number, lng: number) => act(() => cb?.({ coords: { latitude: lat, longitude: lng, accuracy: 5 } })) };
}

function mount(fetchImpl: typeof fetch, geo?: GeoLike | null) {
  const store = new Map<string, string>();
  const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
  render(<SessionProvider apiBaseUrl="http://api.test" allowedRoles={['DRIVER']} storage={storage} fetchImpl={fetchImpl}><App geolocation={geo} /></SessionProvider>);
}

async function signIn() {
  await userEvent.type(screen.getByLabelText('Email'), 'd@x.co');
  await userEvent.type(screen.getByLabelText('Password'), 'password123');
  await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
}

describe('driver app', () => {
  it('separates current deliveries from history and offers the right action', async () => {
    mount(fakeApi([mkOrder('aaaaaaaa-1', 'ASSIGNED'), mkOrder('bbbbbbbb-2', 'IN_TRANSIT'), mkOrder('cccccccc-3', 'DELIVERED')]).impl);
    await signIn();
    const current = await screen.findByRole('list', { name: 'Current deliveries' });
    expect(within(current).getByRole('button', { name: 'Confirm pickup' })).toBeInTheDocument();
    expect(within(current).getByRole('button', { name: 'Mark delivered' })).toBeInTheDocument();
    expect(within(screen.getByRole('list', { name: 'History' })).getByText('DELIVERED')).toBeInTheDocument();
  });

  it('confirms pickup through the status endpoint and delivery steps through the delivery endpoint', async () => {
    const api = fakeApi([mkOrder('aaaaaaaa-1', 'ASSIGNED'), mkOrder('bbbbbbbb-2', 'PICKED_UP'), mkOrder('cccccccc-3', 'IN_TRANSIT')]);
    mount(api.impl);
    await signIn();
    await userEvent.click(await screen.findByRole('button', { name: 'Confirm pickup' }));
    await userEvent.click(screen.getByRole('button', { name: 'Start delivery' }));
    await userEvent.click(screen.getByRole('button', { name: 'Mark delivered' }));
    await waitFor(() => expect(api.calls.filter((c) => c.method === 'POST' && c.path !== '/api/auth/login')).toHaveLength(3));
    const posts = api.calls.filter((c) => c.method === 'POST' && c.path !== '/api/auth/login');
    expect(posts[0]).toMatchObject({ path: '/api/orders/aaaaaaaa-1/status', body: { status: 'PICKED_UP' } });
    expect(posts[1]).toMatchObject({ path: '/api/orders/bbbbbbbb-2/delivery', body: { action: 'PICKED_UP' } });
    expect(posts[2]).toMatchObject({ path: '/api/orders/cccccccc-3/delivery', body: { action: 'DELIVERED' } });
  });

  it('chat: offered for active deliveries only, created on demand, and messages are sent to the thread', async () => {
    const msgs: unknown[] = [];
    const api = fakeApi([mkOrder('aaaaaaaa-1', 'IN_TRANSIT'), mkOrder('cccccccc-3', 'DELIVERED')], {
      'POST /api/orders/aaaaaaaa-1/chat': () => json(200, { id: 't1', order_id: 'aaaaaaaa-1', created_at: '2026-01-01T00:00:00Z', closed_at: null }),
      'GET /api/chat/t1/messages': () => json(200, msgs),
      'POST /api/chat/t1/messages': () => { msgs.push({ id: 'm1', thread_id: 't1', sender_id: 'd-user', body: 'On my way', created_at: '2026-01-01T00:00:00Z' }); return json(201, msgs[0]); },
    });
    mount(api.impl);
    await signIn();
    const current = await screen.findByRole('list', { name: 'Current deliveries' });
    expect(within(screen.getByRole('list', { name: 'History' })).queryByRole('button', { name: 'Open chat' })).not.toBeInTheDocument();
    expect(api.calls.some((c) => c.path.includes('/chat'))).toBe(false);
    await userEvent.click(within(current).getByRole('button', { name: 'Open chat' }));
    await userEvent.type(await screen.findByLabelText('Message'), 'On my way');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByText(/: On my way/)).toBeInTheDocument();
    expect(api.calls.find((c) => c.method === 'POST' && c.path === '/api/chat/t1/messages')?.body).toEqual({ body: 'On my way' });
  });

  it('shows the backend error when a transition is refused', async () => {
    const api = fakeApi([mkOrder('aaaaaaaa-1', 'IN_TRANSIT')], { 'POST /api/orders/aaaaaaaa-1/delivery': () => json(409, { error: 'INVALID_DELIVERY_TRANSITION' }) });
    mount(api.impl);
    await signIn();
    await userEvent.click(await screen.findByRole('button', { name: 'Mark delivered' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('INVALID_DELIVERY_TRANSITION');
  });

  it('shares location for the order using the driver profile id, only while sharing is on', async () => {
    const api = fakeApi([mkOrder('aaaaaaaa-1', 'IN_TRANSIT')]);
    const g = fakeGeo();
    mount(api.impl, g.geo);
    await signIn();
    await screen.findByRole('button', { name: 'Mark delivered' });
    expect(g.geo.watchPosition).not.toHaveBeenCalled();
    await userEvent.click(screen.getByLabelText('Share location'));
    await waitFor(() => expect(g.geo.watchPosition).toHaveBeenCalled());
    g.emit(40.5, -74.25);
    await waitFor(() => expect(api.calls.find((c) => c.path === '/api/drivers/profile-1/location')?.body).toEqual({ lat: 40.5, lng: -74.25, accuracyM: 5, orderId: 'aaaaaaaa-1' }));
    await userEvent.click(screen.getByLabelText('Share location'));
    expect(g.geo.clearWatch).toHaveBeenCalledWith(7);
  });

  it('offers no location sharing for completed orders', async () => {
    mount(fakeApi([mkOrder('cccccccc-3', 'DELIVERED')]).impl, fakeGeo().geo);
    await signIn();
    await screen.findByRole('list', { name: 'History' });
    expect(screen.queryByLabelText('Share location')).not.toBeInTheDocument();
  });

  it('earnings: reads them with the profile id learned from an assigned order, read-only', async () => {
    const row = { id: 'e1', driver_id: 'profile-1', order_id: 'abcdef12-0000', status: 'ELIGIBLE', created_at: '2026-01-01T00:00:00Z', net_amount: '5.00', net_amount_cents: '500' };
    const api = fakeApi([mkOrder('aaaaaaaa-1', 'DELIVERED')], { 'GET /api/drivers/profile-1/earnings': () => json(200, [row]) });
    mount(api.impl);
    await signIn();
    await userEvent.click(await screen.findByRole('button', { name: 'Earnings' }));
    expect(await screen.findByText(/\$5\.00/)).toBeInTheDocument();
    expect(screen.getByText(/Payouts are not enabled/)).toBeInTheDocument();
    expect(api.calls.filter((c) => c.path.includes('earnings')).every((c) => c.method === 'GET')).toBe(true);
  });

  it('earnings: explains the empty state and never calls the API without a profile id', async () => {
    const api = fakeApi([]);
    mount(api.impl);
    await signIn();
    await userEvent.click(await screen.findByRole('button', { name: 'Earnings' }));
    expect(await screen.findByText(/once you have been assigned a delivery/)).toBeInTheDocument();
    expect(api.calls.some((c) => c.path.includes('earnings'))).toBe(false);
  });

  it('notifications tab lists the driver\'s notifications', async () => {
    const api = fakeApi([], { 'GET /api/notifications': () => json(200, [{ id: 'n1', event_type: 'X', title: 'New job', body: 'b', order_id: null, read_at: null, created_at: '2026-01-01T00:00:00Z' }]) });
    mount(api.impl);
    await signIn();
    await userEvent.click(await screen.findByRole('button', { name: 'Notifications' }));
    expect(await screen.findByText('New job')).toBeInTheDocument();
  });
});

describe('useLocationSharing', () => {
  it('throttles uploads and reports geolocation being unavailable', async () => {
    const g = fakeGeo();
    const send = vi.fn().mockResolvedValue({});
    renderHook(() => useLocationSharing({ enabled: true, intervalMs: 60_000, send, geolocation: g.geo }));
    g.emit(1, 2); g.emit(3, 4);
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(send).toHaveBeenCalledWith({ lat: 1, lng: 2, accuracyM: 5 });

    const { result } = renderHook(() => useLocationSharing({ enabled: true, send, geolocation: null }));
    await waitFor(() => expect(result.current.error).toBe('Location is not available on this device'));
  });
});
