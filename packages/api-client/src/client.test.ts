import { describe, expect, it, vi } from 'vitest';
import { ApiError, createApiClient } from './client.js';
import { formatMoney, merchantNextStatus, netAmountCents } from './format.js';

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

  it('checks service-area eligibility without requiring authentication', async () => {
    const { client, fetchImpl } = setup(reply(200, { eligible: true, areaName: 'Spring Valley' }), null);
    expect(await client.serviceAreas.check('NY', '10977')).toEqual({ eligible: true, areaName: 'Spring Valley' });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://api.test/api/service-areas/eligibility?stateCode=NY&postalCode=10977');
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
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

  it('exposes no refund, payout or settlement/earnings creation calls', () => {
    const { client } = setup(reply(200, {}));
    const keys = JSON.stringify(Object.entries(client).map(([k, v]) => [k, Object.keys(v)]));
    expect(keys).not.toMatch(/refund|payout|markPaid|createSettle|createEarning/i);
    expect(Object.keys(client.finance).sort()).toEqual(['driverEarnings', 'merchantSettlements']);
  });

  it('finance views only ever issue GET requests', async () => {
    const a = setup(reply(200, []));
    await a.client.finance.driverEarnings('d1');
    const b = setup(reply(200, []));
    await b.client.finance.merchantSettlements('m1');
    for (const f of [a.fetchImpl, b.fetchImpl]) {
      const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
      expect(init.method).toBe('GET');
      expect(init.body).toBeUndefined();
      expect(url).toMatch(/\/api\/(drivers\/d1\/earnings|merchants\/m1\/settlements)$/);
    }
  });

  it('parses notifications and promo previews, and rejects malformed ones', async () => {
    const n = { id: 'n1', event_type: 'ORDER', title: 'Hi', body: 'b', order_id: null, read_at: null, created_at: '2026-01-01T00:00:00Z', data: {} };
    expect((await setup(reply(200, [n])).client.notifications.list())[0].title).toBe('Hi');
    await expect(setup(reply(200, [{ id: 1 }])).client.notifications.list()).rejects.toMatchObject({ message: 'Unexpected response from server' });
    const p = await setup(reply(200, { promoId: 'p', code: 'SAVE', discount: 2.5 })).client.promos.validate('save', 20);
    expect(p.discount).toBe(2.5);
  });
});

describe('format helpers', () => {
  it('formats cents', () => expect(formatMoney(1234)).toBe('$12.34'));
  it('maps merchant next statuses', () => expect(merchantNextStatus.PAID).toBe('ACCEPTED'));
  it('derives net cents, preferring the BIGINT column', () => {
    expect(netAmountCents({ net_amount_cents: '1250', net_amount: '99.00' })).toBe(1250);
    expect(netAmountCents({ net_amount_cents: null, net_amount: '12.34' })).toBe(1234);
    expect(netAmountCents({})).toBeNull();
  });

  it('lists merchant reviews and manages promos via the documented endpoints', async () => {
    const list = setup(reply(200, { average: 4.5, count: 1, limit: 20, offset: 0, items: [{ id: 'r', rating: 5, body: null, createdAt: 'x' }] }));
    expect((await list.client.reviews.forMerchant('m1')).average).toBe(4.5);
    expect((list.fetchImpl.mock.calls[0] as unknown as [string])[0]).toContain('/api/merchants/m1/reviews');

    const promo = { id: 'p', code: 'A', discountType: 'FIXED', amountCents: 100, maxDiscountCents: null, minOrderTotalCents: 0, usageLimit: null, usedCount: 0, startsAt: 's', expiresAt: null, active: true };
    const a = setup(reply(201, promo));
    await a.client.admin.promos.create({ code: 'AAA', discountType: 'FIXED', amountCents: 100 });
    const [url, init] = a.fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/api/admin/promos');
    expect(init.method).toBe('POST');
    const b = setup(reply(200, { ...promo, active: false }));
    expect((await b.client.admin.promos.setActive('p', false)).active).toBe(false);
    expect((b.fetchImpl.mock.calls[0] as unknown as [string])[0]).toContain('/api/admin/promos/p/active');
  });
});
