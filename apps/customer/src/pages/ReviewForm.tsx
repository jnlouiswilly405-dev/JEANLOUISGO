import { useState, type FormEvent } from 'react';
import { ErrorBanner, useLocalization, useSession } from '@multigo/app-shell';
import { ApiError } from '@multigo/api-client';

/** Rating form for a delivered order (POST /api/reviews). The backend allows one review per order and reviewer. */
export function ReviewForm({ orderId, merchantId }: { orderId: string; merchantId: string }) {
  const { client } = useSession();
  const { t } = useLocalization();
  const [rating, setRating] = useState(5);
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const text = body.trim();
      await client.reviews.create({ orderId, rating, merchantId, ...(text ? { body: text } : {}) });
      setDone(true);
    } catch (err) {
      // The backend returns stable codes; raw text is never shown.
      const text = err instanceof Error ? err.message : '';
      setError(
        text.includes('REVIEW_ALREADY_EXISTS') ? t('reviewAlreadyExists')
        : text.includes('ORDER_NOT_DELIVERED') ? t('reviewAfterDelivered')
        : err instanceof ApiError && err.status === 403 ? t('reviewOnlyCustomer')
        : t('couldNotSendReview'),
      );
    } finally {
      setBusy(false);
    }
  }

  if (done) return <p role="status">{t('thankYouReview')}</p>;
  return (
    <form onSubmit={submit} aria-label={t('rateOrder')}>
      <label>{t('rating')}
        <select value={rating} onChange={(e) => setRating(Number(e.target.value))}>
          {[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{t('outOfFive', { rating: n })}</option>)}
        </select>
      </label>
      <label>{t('commentOptional')}<textarea value={body} onChange={(e) => setBody(e.target.value)} maxLength={5000} /></label>
      <ErrorBanner message={error} />
      <button type="submit" disabled={busy}>{t('sendReview')}</button>
    </form>
  );
}
