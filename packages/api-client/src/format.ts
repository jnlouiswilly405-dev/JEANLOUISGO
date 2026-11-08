/** Backend amounts are integer cents; the currency is always reported by the API (currently USD). */
export function formatMoney(cents: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);
}

/**
 * The single status a merchant may request next (backend: merchants may only set ACCEPTED, PREPARING, READY,
 * and only when the transition is valid). Other statuses have no merchant action.
 */
export const merchantNextStatus = { PAID: 'ACCEPTED', ACCEPTED: 'PREPARING', PREPARING: 'READY' } as const;
