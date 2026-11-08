import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SessionProvider } from '@multigo/app-shell';
import { PromoPreview } from './pages/PromoPreview.js';
import { ReviewForm } from './pages/ReviewForm.js';

const user = { id: 'u1', email: 'c@x.co', displayName: 'Cleo', role: 'CUSTOMER' };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

function mount(ui: React.ReactElement, handlers: Record<string, (body: any) => Response>) {
  const calls: { key: string; body?: any }[] = [];
  const impl = vi.fn(async (url: string, init: RequestInit = {}) => {
    const key = `${init.method ?? 'GET'} ${new URL(url).pathname}`;
    const body = init.body ? JSON.parse(init.body as string) : undefined;
    calls.push({ key, body });
    if (key === 'GET /api/auth/me') return json(200, { user });
    return handlers[key]?.(body) ?? json(404, { error: key });
  });
  const store = new Map([['multigo.session', 'tok']]);
  const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
  render(<SessionProvider apiBaseUrl="http://api.test" allowedRoles={['CUSTOMER']} storage={storage} fetchImpl={impl as unknown as typeof fetch}>{ui}</SessionProvider>);
  return calls;
}

describe('PromoPreview', () => {
  it('sends the cart total in major units and labels the result as a preview', async () => {
    const calls = mount(<PromoPreview subtotalCents={2400} />, { 'POST /api/promos/validate': () => json(200, { promoId: 'p', code: 'SAVE10', discount: 2.4 }) });
    await userEvent.type(await screen.findByLabelText('Promo code'), 'save10');
    await userEvent.click(screen.getByRole('button', { name: 'Check code' }));
    expect(await screen.findByRole('status')).toHaveTextContent('$2.40 off');
    expect(screen.getByRole('status')).toHaveTextContent('Preview only');
    expect(calls.find((c) => c.key === 'POST /api/promos/validate')?.body).toEqual({ code: 'save10', orderTotal: 24 });
  });

  it('maps backend promo errors to friendly messages', async () => {
    mount(<PromoPreview subtotalCents={1000} />, { 'POST /api/promos/validate': () => json(409, { error: 'PROMO_ALREADY_USED' }) });
    await userEvent.type(await screen.findByLabelText('Promo code'), 'X');
    await userEvent.click(screen.getByRole('button', { name: 'Check code' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('You have already used this code.');
  });

  it('keeps the check button disabled for an empty code', async () => {
    mount(<PromoPreview subtotalCents={1000} />, {});
    expect(await screen.findByRole('button', { name: 'Check code' })).toBeDisabled();
  });
});

describe('ReviewForm', () => {
  const orderId = '11111111-1111-4111-8111-111111111111';
  const merchantId = '22222222-2222-4222-8222-222222222222';

  it('submits rating, comment and merchant for the order', async () => {
    const calls = mount(<ReviewForm orderId={orderId} merchantId={merchantId} />, { 'POST /api/reviews': () => json(201, { id: 'r1' }) });
    await userEvent.selectOptions(await screen.findByLabelText('Rating'), '4');
    await userEvent.type(screen.getByLabelText('Comment (optional)'), ' Tasty ');
    await userEvent.click(screen.getByRole('button', { name: 'Send review' }));
    expect(await screen.findByText('Thank you for your review.')).toBeInTheDocument();
    expect(calls.find((c) => c.key === 'POST /api/reviews')?.body).toEqual({ orderId, rating: 4, merchantId, body: 'Tasty' });
  });

  it('omits an empty comment and shows a friendly message on a duplicate (409)', async () => {
    const calls = mount(<ReviewForm orderId={orderId} merchantId={merchantId} />, { 'POST /api/reviews': () => json(409, { error: 'REVIEW_ALREADY_EXISTS' }) });
    await userEvent.click(await screen.findByRole('button', { name: 'Send review' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('You have already reviewed this order.');
    expect(screen.queryByText(/constraint/)).not.toBeInTheDocument();
    expect(calls.find((c) => c.key === 'POST /api/reviews')?.body).toEqual({ orderId, rating: 5, merchantId });
  });

  it('explains a not-delivered rejection', async () => {
    mount(<ReviewForm orderId={orderId} merchantId={merchantId} />, { 'POST /api/reviews': () => json(409, { error: 'ORDER_NOT_DELIVERED' }) });
    await userEvent.click(await screen.findByRole('button', { name: 'Send review' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('only after it is delivered');
  });
});
