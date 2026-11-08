import { useState, type FormEvent } from 'react';
import { ErrorBanner, useSession } from '@multigo/app-shell';
import { ApiError } from '@multigo/api-client';

/** Rating form for a delivered order (POST /api/reviews). The backend allows one review per order and reviewer. */
export function ReviewForm({ orderId, merchantId }: { orderId: string; merchantId: string }) {
  const { client } = useSession();
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
        text.includes('REVIEW_ALREADY_EXISTS') ? 'You have already reviewed this order.'
        : text.includes('ORDER_NOT_DELIVERED') ? 'You can review an order only after it is delivered.'
        : err instanceof ApiError && err.status === 403 ? 'Only the customer who placed the order can review it.'
        : 'Could not send the review.',
      );
    } finally {
      setBusy(false);
    }
  }

  if (done) return <p role="status">Thank you for your review.</p>;
  return (
    <form onSubmit={submit} aria-label="Rate this order">
      <label>Rating
        <select value={rating} onChange={(e) => setRating(Number(e.target.value))}>
          {[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n} / 5</option>)}
        </select>
      </label>
      <label>Comment (optional)<textarea value={body} onChange={(e) => setBody(e.target.value)} maxLength={5000} /></label>
      <ErrorBanner message={error} />
      <button type="submit" disabled={busy}>Send review</button>
    </form>
  );
}
