import { ErrorBanner, useAsync, useSession } from '@multigo/app-shell';
import { formatMoney } from '@multigo/api-client';

export function OrderList({ onOpen }: { onOpen: (id: string) => void }) {
  const { client } = useSession();
  const { data, error, loading } = useAsync(() => client.orders.list(), [client]);
  return (
    <section aria-label="My orders">
      <h2>My orders</h2>
      {loading && <p role="status">Loading…</p>}
      <ErrorBanner message={error} />
      {data?.length === 0 && <p className="muted">You have not placed any orders yet.</p>}
      <ul>
        {data?.map((o) => (
          <li key={o.id}>
            <span>{new Date(o.createdAt).toLocaleString()} · {formatMoney(o.totalCents, o.currency)}</span>
            <span><em>{o.status}</em> <button onClick={() => onOpen(o.id)}>Details</button></span>
          </li>
        ))}
      </ul>
    </section>
  );
}
