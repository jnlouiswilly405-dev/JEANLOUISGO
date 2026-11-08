import { useState } from 'react';
import { ErrorBanner } from './components.js';
import { useAsync } from './useAsync.js';
import { useSession } from './session.js';

const PAGE = 5;

/** Public review summary for a merchant (GET /api/merchants/:id/reviews): rating, text and date only. */
export function ReviewList({ merchantId }: { merchantId: string }) {
  const { client } = useSession();
  const [offset, setOffset] = useState(0);
  const page = useAsync(() => client.reviews.forMerchant(merchantId, { limit: PAGE, offset }), [client, merchantId, offset]);
  const d = page.data;
  return (
    <section aria-label="Reviews">
      <h3>Reviews</h3>
      {page.loading && !d && <p role="status">Loading…</p>}
      <ErrorBanner message={page.error} />
      {d && d.count === 0 && <p className="muted">No reviews yet.</p>}
      {d && d.count > 0 && <p>Average rating: <strong>{d.average?.toFixed(1)}</strong> ({d.count} review{d.count === 1 ? '' : 's'})</p>}
      <ul aria-label="Review list">
        {d?.items.map((r) => (
          <li key={r.id}>
            <span aria-label={`${r.rating} out of 5`}>{'★'.repeat(r.rating)}{'☆'.repeat(5 - r.rating)}</span>
            {r.body ? <span> {r.body}</span> : null}
            <small className="muted"> {new Date(r.createdAt).toLocaleDateString()}</small>
          </li>
        ))}
      </ul>
      {d && d.count > PAGE && (
        <div className="pager">
          <button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>Previous reviews</button>
          <button disabled={offset + d.items.length >= d.count} onClick={() => setOffset(offset + PAGE)}>Next reviews</button>
        </div>
      )}
    </section>
  );
}
