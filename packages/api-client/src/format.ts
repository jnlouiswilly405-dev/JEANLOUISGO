/** Backend amounts are integer cents; the currency is always reported by the API (currently USD). */
export function formatMoney(cents: number, currency = 'USD', locale = 'en-US'): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(cents / 100);
}

/**
 * The single status a merchant may request next (backend: merchants may only set ACCEPTED, PREPARING, READY,
 * and only when the transition is valid). Other statuses have no merchant action.
 */
export const merchantNextStatus = { PAID: 'ACCEPTED', ACCEPTED: 'PREPARING', PREPARING: 'READY' } as const;

/** Net amount in cents for an earnings/settlement row, preferring the BIGINT cents column over the legacy NUMERIC one. */
export function netAmountCents(row: { net_amount?: string | null; net_amount_cents?: string | null }): number | null {
  if (row.net_amount_cents != null) return Number(row.net_amount_cents);
  if (row.net_amount != null) return Math.round(Number(row.net_amount) * 100);
  return null;
}
