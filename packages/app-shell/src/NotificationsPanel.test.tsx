import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SessionProvider, NotificationsPanel } from './index.js';

const user = { id: 'u1', email: 'c@x.co', displayName: 'Cleo', role: 'CUSTOMER' };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const note = (id: string, read: string | null, title = `T-${id}`) => ({ id, event_type: 'X', title, body: `B-${id}`, order_id: null, read_at: read, created_at: '2026-01-01T00:00:00Z', data: {} });

function mount(state: { rows: ReturnType<typeof note>[]; failRead?: boolean }) {
  const calls: string[] = [];
  const impl = vi.fn(async (url: string, init: RequestInit = {}) => {
    const path = new URL(url).pathname;
    const key = `${init.method ?? 'GET'} ${path}`;
    calls.push(key);
    if (key === 'GET /api/auth/me') return json(200, { user });
    if (key === 'GET /api/notifications') return json(200, state.rows);
    const m = /^POST \/api\/notifications\/(.+)\/read$/.exec(key);
    if (m) {
      if (state.failRead) return json(404, { error: 'NOTIFICATION_NOT_FOUND' });
      const row = state.rows.find((r) => r.id === m[1])!;
      row.read_at = '2026-01-02T00:00:00Z';
      return json(200, row);
    }
    return json(404, { error: key });
  });
  const store = new Map([['multigo.session', 'tok']]);
  const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
  render(<SessionProvider apiBaseUrl="http://api.test" allowedRoles={['CUSTOMER']} storage={storage} fetchImpl={impl as unknown as typeof fetch}><NotificationsPanel /></SessionProvider>);
  return calls;
}

describe('NotificationsPanel', () => {
  it('shows an empty state', async () => {
    mount({ rows: [] });
    expect(await screen.findByText('No notifications.')).toBeInTheDocument();
  });

  it('lists notifications, flags unread ones and marks one read', async () => {
    const calls = mount({ rows: [note('a', null), note('b', '2026-01-01T00:00:00Z')] });
    expect(await screen.findByText('T-a')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Mark read' })).toHaveLength(1);
    await userEvent.click(screen.getByRole('button', { name: 'Mark read' }));
    await vi.waitFor(() => expect(screen.queryByRole('button', { name: 'Mark read' })).not.toBeInTheDocument());
    expect(calls).toContain('POST /api/notifications/a/read');
  });

  it('renders markup in notification text as plain text', async () => {
    mount({ rows: [note('a', null, '<img src=x onerror=alert(1)>')] });
    expect(await screen.findByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
    expect(document.querySelector('img')).toBeNull();
  });

  it('surfaces a failed mark-read', async () => {
    mount({ rows: [note('a', null)], failRead: true });
    await userEvent.click(await screen.findByRole('button', { name: 'Mark read' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('NOTIFICATION_NOT_FOUND');
  });
});
