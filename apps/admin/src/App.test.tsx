import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SessionProvider } from '@multigo/app-shell';
import { App } from './App.js';

const admin = { id: 'a1', email: 'a@x.co', displayName: 'Ada', role: 'ADMIN' };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const event = (n: number) => ({
  id: `evt-${n}`, eventType: 'SETTLEMENT_REQUESTED', aggregateType: 'ORDER', aggregateId: `ord-${n}`,
  status: 'BLOCKED', attempts: 5, createdAt: '2026-01-01T00:00:00Z', failureReason: 'PAYOUT_PROVIDER_CONFIRMATION_REQUIRED',
});

function fakeApi(opts: { loginUser?: unknown; outboxTotal?: number } = {}) {
  const calls: { method: string; path: string; query: URLSearchParams }[] = [];
  const impl = vi.fn(async (url: string, init: RequestInit = {}) => {
    const u = new URL(url);
    const method = init.method ?? 'GET';
    calls.push({ method, path: u.pathname, query: u.searchParams });
    const key = `${method} ${u.pathname}`;
    if (key === 'POST /api/auth/login') return json(200, { user: opts.loginUser ?? admin, token: 'tok' });
    if (key === 'GET /api/admin/health') return json(200, { database: 'ok', latencyMs: 3, checkedAt: '2026-01-01T00:00:00Z' });
    if (key === 'GET /api/admin/financial-summary') return json(200, [{ currency: 'USD', platform_clearing_cents: '1200' }]);
    if (key === 'GET /api/admin/outbox/blocked') {
      const offset = Number(u.searchParams.get('offset') ?? 0);
      const total = opts.outboxTotal ?? 1;
      const items = Array.from({ length: Math.max(0, Math.min(20, total - offset)) }, (_, i) => event(offset + i));
      return json(200, { items, total, limit: 20, offset });
    }
    if (key === 'GET /api/admin/payments/unreferenced') {
      return json(200, { items: [{ paymentId: 'pay-1', orderId: 'ord-1', amountCents: 1250, currency: 'USD', createdAt: '2026-01-01T00:00:00Z', ageMinutes: 42 }], total: 1, limit: 20, offset: 0, olderThanMinutes: 15 });
    }
    return json(404, { error: `no route ${key}` });
  });
  return { impl: impl as unknown as typeof fetch, calls };
}

function mount(fetchImpl: typeof fetch) {
  const store = new Map<string, string>();
  const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
  render(<SessionProvider apiBaseUrl="http://api.test" allowedRoles={['ADMIN']} storage={storage} fetchImpl={fetchImpl}><App /></SessionProvider>);
}

async function signIn() {
  await userEvent.type(screen.getByLabelText('Email'), 'a@x.co');
  await userEvent.type(screen.getByLabelText('Password'), 'password123');
  await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
}

describe('admin app', () => {
  it('rejects non-admin accounts and never calls admin endpoints', async () => {
    const api = fakeApi({ loginUser: { ...admin, role: 'CUSTOMER' } });
    mount(api.impl);
    await signIn();
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(api.calls.some((c) => c.path.startsWith('/api/admin'))).toBe(false);
  });

  it('shows health and the read-only financial summary', async () => {
    mount(fakeApi().impl);
    await signIn();
    expect(await screen.findByText('ok')).toBeInTheDocument();
    expect(await screen.findByText('1200')).toBeInTheDocument();
    expect(screen.getByText(/Read-only console/)).toBeInTheDocument();
  });

  it('lists BLOCKED outbox events with the sanitized failure reason', async () => {
    mount(fakeApi().impl);
    await signIn();
    await userEvent.click(await screen.findByRole('button', { name: 'Blocked outbox' }));
    expect(await screen.findByText('evt-0')).toBeInTheDocument();
    expect(screen.getByText('PAYOUT_PROVIDER_CONFIRMATION_REQUIRED')).toBeInTheDocument();
    expect(screen.getByText('1–1 of 1')).toBeInTheDocument();
  });

  it('sends filters and paginates', async () => {
    const api = fakeApi({ outboxTotal: 25 });
    mount(api.impl);
    await signIn();
    await userEvent.click(await screen.findByRole('button', { name: 'Blocked outbox' }));
    await screen.findByText('evt-0');
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByText('evt-20');
    expect(screen.getByText('21–25 of 25')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Event type'), 'SETTLEMENT_REQUESTED');
    await userEvent.click(screen.getByRole('button', { name: 'Filter' }));
    await vi.waitFor(() => {
      const last = api.calls.filter((c) => c.path === '/api/admin/outbox/blocked').at(-1)!;
      expect(last.query.get('eventType')).toBe('SETTLEMENT_REQUESTED');
      expect(last.query.get('offset')).toBe('0');
    });
  });

  it('shows unreferenced payments and issues only GET requests to admin endpoints', async () => {
    const api = fakeApi();
    mount(api.impl);
    await signIn();
    await userEvent.click(await screen.findByRole('button', { name: 'Unreferenced payments' }));
    expect(await screen.findByText('pay-1')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(api.calls.filter((c) => c.path.startsWith('/api/admin')).every((c) => c.method === 'GET')).toBe(true);
  });
});
