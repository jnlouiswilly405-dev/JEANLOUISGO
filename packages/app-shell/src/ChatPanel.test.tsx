import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SessionProvider, ChatPanel } from './index.js';

const user = { id: 'u1', email: 'c@x.co', displayName: 'Cleo', role: 'CUSTOMER' };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const msg = (id: string, sender: string, body: string) => ({ id, thread_id: 't1', sender_id: sender, body, created_at: '2026-01-01T10:00:00Z' });

function mount(opts: { rows?: ReturnType<typeof msg>[]; openStatus?: number; openError?: string; sendStatus?: number } = {}) {
  const rows = opts.rows ?? [];
  const calls: Array<{ key: string; body?: unknown }> = [];
  const impl = vi.fn(async (url: string, init: RequestInit = {}) => {
    const key = `${init.method ?? 'GET'} ${new URL(url).pathname}`;
    calls.push({ key, body: init.body ? JSON.parse(String(init.body)) : undefined });
    if (key === 'GET /api/auth/me') return json(200, { user });
    if (key === 'POST /api/orders/o1/chat') {
      return opts.openStatus && opts.openStatus >= 400
        ? json(opts.openStatus, { error: opts.openError ?? 'ORDER_NOT_FOUND' })
        : json(200, { id: 't1', order_id: 'o1', created_at: '2026-01-01T00:00:00Z', closed_at: null });
    }
    if (key === 'GET /api/chat/t1/messages') return json(200, rows);
    if (key === 'POST /api/chat/t1/messages') {
      if (opts.sendStatus) return json(opts.sendStatus, { error: 'THREAD_CLOSED' });
      const m = msg(`m${rows.length + 1}`, 'u1', JSON.parse(String(init.body)).body);
      rows.push(m);
      return json(201, m);
    }
    return json(404, { error: key });
  });
  const store = new Map([['multigo.session', 'tok']]);
  const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
  render(<SessionProvider apiBaseUrl="http://api.test" allowedRoles={['CUSTOMER']} storage={storage} fetchImpl={impl as unknown as typeof fetch}><ChatPanel orderId="o1" /></SessionProvider>);
  return calls;
}

describe('ChatPanel', () => {
  it('opens the order thread, labels own and other messages and shows an empty state', async () => {
    mount({ rows: [msg('a', 'u1', 'hi'), msg('b', 'u2', 'hello')] });
    expect(await screen.findByText(/hi/)).toBeInTheDocument();
    expect(screen.getByText('You')).toBeInTheDocument();
    expect(screen.getByText('Them')).toBeInTheDocument();
  });

  it('shows "No messages yet." for an empty thread', async () => {
    mount();
    expect(await screen.findByText('No messages yet.')).toBeInTheDocument();
  });

  it('sends a trimmed message and shows it', async () => {
    const calls = mount();
    await userEvent.type(await screen.findByLabelText('Message'), '  on my way  ');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByText(/on my way/)).toBeInTheDocument();
    expect(calls.find((c) => c.key === 'POST /api/chat/t1/messages')?.body).toEqual({ body: 'on my way' });
  });

  it('does not send blank messages', async () => {
    mount();
    await screen.findByLabelText('Message');
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
  });

  it('renders markup as plain text', async () => {
    mount({ rows: [msg('a', 'u2', '<img src=x onerror=alert(1)>')] });
    expect(await screen.findByText(/<img src=x onerror=alert\(1\)>/)).toBeInTheDocument();
    expect(document.querySelector('img')).toBeNull();
  });

  it('explains a thread that is not available yet, without a send form', async () => {
    mount({ openStatus: 409, openError: 'CHAT_NOT_AVAILABLE' });
    expect(await screen.findByRole('alert')).toHaveTextContent('Chat opens once the order is paid.');
    expect(screen.queryByLabelText('Message')).not.toBeInTheDocument();
  });

  it('explains a closed thread when sending', async () => {
    mount({ sendStatus: 409 });
    await userEvent.type(await screen.findByLabelText('Message'), 'x');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('This conversation is closed.');
  });
});
