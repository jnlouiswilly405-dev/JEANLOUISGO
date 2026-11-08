import { useState, type FormEvent } from 'react';
import { ErrorBanner, useSession } from '@multigo/app-shell';
import { formatMoney, type PromoPreview as Preview } from '@multigo/api-client';

/**
 * Checks a promo code against the cart. Checking never redeems anything: the code is sent with the order
 * and the server re-validates it and computes the discount, so the amount shown here is only an estimate.
 */
export function PromoPreview({ subtotalCents, onChange }: { subtotalCents: number; onChange?: (code: string | null) => void }) {
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
    onChange?.(null);
    try {
      // The backend's promo amounts are NUMERIC major units, so the cart total is sent in dollars, not cents.
      const preview = await client.promos.validate(code.trim(), subtotalCents / 100);
      setResult(preview);
      onChange?.(code.trim());
    } catch (err) {
      setError(promoMessage(err instanceof Error ? err.message : ''));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={check} aria-label="Promotion">
      <label>Promo code<input value={code} onChange={(e) => { setCode(e.target.value); setResult(null); onChange?.(null); }} maxLength={64} /></label>
      <button type="submit" disabled={busy || code.trim() === ''}>Check code</button>
      <ErrorBanner message={error} />
      {result && (
        <p role="status">
          Code {result.code} is valid: {formatMoney(Math.round(result.discount * 100))} off.
          {' '}<span className="muted">{onChange ? 'Applied when you place the order; the server re-checks it.' : 'Preview only.'}</span>
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
