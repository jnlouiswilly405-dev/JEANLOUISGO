import { describe, expect, it, vi } from 'vitest';
import { ApiError, createApiClient } from './client.js';
import { formatMoney, merchantNextStatus } from './format.js';

const user = { id: 'u1', email: 'a@b.co', displayName: 'Ada', role: 'CUSTOMER' };
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

function setup(res: Response | Error, token: string | null = 'tok') {
  const fetchImpl = vi.fn(async () => { if (res instanceof Error) throw res; return res; });
  const onUnauthorized = vi.fn();
  const client = createApiClient({ baseUrl: 'http://api.test/', getToken: () => token, onUnauthorized, fetchImpl: fetchImpl as unknown as typeof fetch });
  return { client, fetchImpl, onUnauthorized };
}

describe('api client', () => {
  it('logs in without a token header and parses the result', async () => {
    const { client, fetchImpl } = setup(reply(200, { user, token: 't' }), null);
    expect((await client.auth.login('a@b.co', 'password1')).token).toBe('t');
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://api.test/api/auth/login');
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
    expect(JSON.parse(init.body as string)).toEqual({ email: 'a@b.co', password: 'password1' });
  });

  it('sends the bearer token and serialises query parameters', async () => {
    const { client, fetchImpl } = setup(reply(200, { items: [], total: 0, limit: 10, offset: 20 }));
    await client.admin.blockedOutbox({ limit: 10, offset: 20, eventType: 'a b' });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://api.test/api/admin/outbox/blocked?limit=10&offset=20&eventType=a%20b');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
  });

  it('maps string and zod-issue error bodies to ApiError and signals 401', async () => {
    const a = setup(reply(401, { error: 'Invalid or expired token' }));
    await expect(a.client.orders.list()).rejects.toMatchObject({ status: 401, message: 'Invalid or expired token' });
    expect(a.onUnauthorized).toHaveBeenCalledOnce();
    const b = setup(reply(400, { error: [{ message: 'Too short' }, { message: 'Bad email' }] }));
    await expect(b.client.auth.login('x', 'y')).rejects.toMatchObject({ status: 400, message: 'Too short; Bad email' });
    expect(b.onUnauthorized).not.toHaveBeenCalled();
  });

  it('does not treat 403 as an expired session', async () => {
    const { client, onUnauthorized } = setup(reply(403, { error: 'Insufficient permissions' }));
    await expect(client.admin.health()).rejects.toBeInstanceOf(ApiError);
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it('rejects malformed success bodies and network failures', async () => {
    await expect(setup(reply(200, { nope: true })).client.auth.me()).rejects.toMatchObject({ message: 'Unexpected response from server' });
    await expect(setup(new Error('down')).client.auth.me()).rejects.toMatchObject({ status: 0, message: 'Network error' });
  });

  it('creates payments with an idempotency key and exposes the Stripe client secret', async () => {
    const row = { id: 'p1', order_id: 'o1', provider: 'stripe', status: 'PENDING', amount_cents: 500, clientSecret: 'pi_x_secret_y' };
    const { client, fetchImpl } = setup(reply(201, row));
    const p = await client.payments.create({ orderId: 'o1', provider: 'stripe', amountCents: 500, idempotencyKey: 'k'.repeat(20) });
    expect(p.clientSecret).toBe('pi_x_secret_y');
    expect(JSON.parse((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body as string).idempotencyKey).toHaveLength(20);
  });

  it('exposes no refund, settlement, earnings or payout calls', () => {
    const { client } = setup(reply(200, {}));
    const keys = JSON.stringify(Object.entries(client).map(([k, v]) => [k, Object.keys(v)]));
    expect(keys).not.toMatch(/refund|settle|earning|payout/i);
  });
});

describe('format helpers', () => {
  it('formats cents', () => expect(formatMoney(1234)).toBe('$12.34'));
  it('maps merchant next statuses', () => expect(merchantNextStatus.PAID).toBe('ACCEPTED'));
});
