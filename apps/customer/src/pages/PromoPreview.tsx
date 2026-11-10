import { useState, type FormEvent } from 'react';
import { ErrorBanner, useLocalization, useSession } from '@multigo/app-shell';
import { formatMoney, type PromoPreview as Preview } from '@multigo/api-client';

/**
 * Checks a promo code against the cart. Checking never redeems anything: the code is sent with the order
 * and the server re-validates it and computes the discount, so the amount shown here is only an estimate.
 */
export function PromoPreview({ subtotalCents, onChange }: { subtotalCents: number; onChange?: (code: string | null) => void }) {
  const { client } = useSession();
  const { locale, t } = useLocalization();
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
      setError(promoMessage(err instanceof Error ? err.message : '', t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={check} aria-label={t('promotion')}>
      <label>{t('promoCode')}<input value={code} onChange={(e) => { setCode(e.target.value); setResult(null); onChange?.(null); }} maxLength={64} /></label>
      <button type="submit" disabled={busy || code.trim() === ''}>{t('checkCode')}</button>
      <ErrorBanner message={error} />
      {result && (
        <p role="status">
          {t('codeValid', { code: result.code, discount: formatMoney(Math.round(result.discount * 100), 'USD', locale) })}
          {' '}<span className="muted">{onChange ? t('applyWhenPlacing') : t('previewOnly')}</span>
        </p>
      )}
    </form>
  );
}

function promoMessage(raw: string, t: ReturnType<typeof useLocalization>['t']): string {
  if (raw === 'PROMO_ALREADY_USED') return t('promoAlreadyUsed');
  if (raw === 'PROMO_INVALID') return t('codeNotValid');
  return t('couldNotCheckCode');
}
