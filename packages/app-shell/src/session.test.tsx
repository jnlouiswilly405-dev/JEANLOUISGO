import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AuthGate, SessionProvider, useAsync, useSession } from './index.js';

const customer = { id: 'u1', email: 'c@x.co', displayName: 'Cleo', role: 'CUSTOMER' };
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

function memoryStorage(initial?: string) {
  const m = new Map<string, string>(initial ? [['multigo.session', initial]] : []);
  return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
}

function Home() {
  const { user, logout } = useSession();
  return <div><p>Hello {user?.displayName}</p><button onClick={logout}>Log out</button></div>;
}

function renderApp(fetchImpl: typeof fetch, storage = memoryStorage(), roles: ('CUSTOMER' | 'ADMIN')[] = ['CUSTOMER']) {
  render(
    <SessionProvider apiBaseUrl="http://api.test" allowedRoles={roles} storage={storage} fetchImpl={fetchImpl}>
      <AuthGate title="Test app"><Home /></AuthGate>
    </SessionProvider>,
  );
  return storage;
}

async function signIn() {
  await userEvent.type(screen.getByLabelText('Email'), 'c@x.co');
  await userEvent.type(screen.getByLabelText('Password'), 'password123');
  await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
}

describe('session and auth gate', () => {
  it('signs in, stores the token for reloads and signs out', async () => {
    const f = vi.fn(async () => reply(200, { user: customer, token: 'tok-1' }));
    const storage = renderApp(f as unknown as typeof fetch);
    await signIn();
    expect(await screen.findByText('Hello Cleo')).toBeInTheDocument();
    expect(storage.m.get('multigo.session')).toBe('tok-1');
    await userEvent.click(screen.getByRole('button', { name: 'Log out' }));
    expect(await screen.findByRole('form', { name: 'Sign in' })).toBeInTheDocument();
    expect(storage.m.size).toBe(0);
  });

  it('shows the server error for bad credentials and stores nothing', async () => {
    const f = vi.fn(async () => reply(401, { error: 'Invalid email or password' }));
    const storage = renderApp(f as unknown as typeof fetch);
    await signIn();
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password');
    expect(storage.m.size).toBe(0);
  });

  it('rejects accounts whose role is not served by the app and keeps no token', async () => {
    const f = vi.fn(async () => reply(200, { user: { ...customer, role: 'ADMIN' }, token: 'tok-admin' }));
    const storage = renderApp(f as unknown as typeof fetch);
    await signIn();
    expect(await screen.findByRole('alert')).toHaveTextContent('cannot use this application');
    expect(storage.m.size).toBe(0);
  });

  it('restores a stored session through /api/auth/me with the bearer token', async () => {
    const f = vi.fn(async () => reply(200, { user: customer }));
    renderApp(f as unknown as typeof fetch, memoryStorage('stored-token'));
    expect(await screen.findByText('Hello Cleo')).toBeInTheDocument();
    const init = (f.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer stored-token');
  });

  it('drops an expired stored session (401) and shows the login form', async () => {
    const f = vi.fn(async () => reply(401, { error: 'Invalid or expired token' }));
    const storage = renderApp(f as unknown as typeof fetch, memoryStorage('old'));
    expect(await screen.findByRole('form', { name: 'Sign in' })).toBeInTheDocument();
    expect(storage.m.size).toBe(0);
  });

  it('drops a stored session that belongs to a role this app does not serve', async () => {
    const f = vi.fn(async () => reply(200, { user: { ...customer, role: 'ADMIN' } }));
    const storage = renderApp(f as unknown as typeof fetch, memoryStorage('t'));
    expect(await screen.findByRole('form', { name: 'Sign in' })).toBeInTheDocument();
    expect(storage.m.size).toBe(0);
  });
});

describe('useAsync', () => {
  function Probe({ load }: { load: () => Promise<string> }) {
    const { data, error, loading, reload } = useAsync(load);
    return <div>{loading ? 'loading' : error ? `error:${error}` : `data:${data}`}<button onClick={reload}>again</button></div>;
  }

  it('loads, reports errors and reloads on demand', async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue('ok');
    render(<Probe load={load} />);
    expect(await screen.findByText('error:boom')).toBeInTheDocument();
    await userEvent.click(screen.getByText('again'));
    await waitFor(() => expect(screen.getByText('data:ok')).toBeInTheDocument());
    expect(load).toHaveBeenCalledTimes(2);
  });
});
