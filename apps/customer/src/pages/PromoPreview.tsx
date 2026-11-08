import { useState, type FormEvent } from 'react';
import { ErrorBanner, useSession } from '@multigo/app-shell';
import { formatMoney, type PromoPreview as Preview } from '@multigo/api-client';

/**
 * Checks a promo code against the cart. The order API accepts no promo code, so this is a preview only
 * and the discount is never applied to the order total.
 */
export function PromoPreview({ subtotalCents }: { subtotalCents: number }) {
  const { client } = useSession();
  const [code, setCode] = useState('');
  const [result, setResult] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function check(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      // The backend's promo amounts are NUMERIC major units, so the cart total is sent in dollars, not cents.
      setResult(await client.promos.validate(code.trim(), subtotalCents / 100));
    } catch (err) {
      setError(promoMessage(err instanceof Error ? err.message : ''));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={check} aria-label="Promotion">
      <label>Promo code<input value={code} onChange={(e) => setCode(e.target.value)} maxLength={64} /></label>
      <button type="submit" disabled={busy || code.trim() === ''}>Check code</button>
      <ErrorBanner message={error} />
      {result && (
        <p role="status">
          Code {result.code} is valid: {formatMoney(Math.round(result.discount * 100))} off.
          {' '}<span className="muted">Preview only — it is not applied to your order yet.</span>
        </p>
      )}
    </form>
  );
}

function promoMessage(raw: string): string {
  if (raw === 'PROMO_ALREADY_USED') return 'You have already used this code.';
  if (raw === 'PROMO_INVALID') return 'This code is not valid for this order.';
  return 'Could not check the code.';
}
