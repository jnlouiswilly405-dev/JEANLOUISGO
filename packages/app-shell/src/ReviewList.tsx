import { useState } from 'react';
import { ErrorBanner } from './components.js';
import { useAsync } from './useAsync.js';
import { useSession } from './session.js';
import { useLocalization } from './localization.js';

const PAGE = 5;

/** Public review summary for a merchant (GET /api/merchants/:id/reviews): rating, text and date only. */
export function ReviewList({ merchantId }: { merchantId: string }) {
  const { client } = useSession();
  const { locale, t } = useLocalization();
  const [offset, setOffset] = useState(0);
  const page = useAsync(() => client.reviews.forMerchant(merchantId, { limit: PAGE, offset }), [client, merchantId, offset]);
  const d = page.data;
  return (
    <section aria-label={t('reviews')}>
      <h3>{t('reviews')}</h3>
      {page.loading && !d && <p role="status">{t('loading')}</p>}
      <ErrorBanner message={page.error} />
      {d && d.count === 0 && <p className="muted">{t('noReviews')}</p>}
      {d && d.count > 0 && (
        <p>{t('averageRating', { rating: d.average?.toFixed(1) ?? '—' })} ({t(d.count === 1 ? 'oneReview' : 'manyReviews', { count: d.count })})</p>
      )}
      <ul aria-label={t('reviewList')}>
        {d?.items.map((r) => (
          <li key={r.id}>
            <span aria-label={t('outOfFive', { rating: r.rating })}>{'★'.repeat(r.rating)}{'☆'.repeat(5 - r.rating)}</span>
            {r.body ? <span> {r.body}</span> : null}
            <small className="muted"> {new Date(r.createdAt).toLocaleDateString(locale)}</small>
          </li>
        ))}
      </ul>
      {d && d.count > PAGE && (
        <div className="pager">
          <button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>{t('previousReviews')}</button>
          <button disabled={offset + d.items.length >= d.count} onClick={() => setOffset(offset + PAGE)}>{t('nextReviews')}</button>
        </div>
      )}
    </section>
  );
}
