import { ErrorBanner, useAsync, useSession } from '@multigo/app-shell';
import type { Merchant } from '@multigo/api-client';

export function MerchantList({ onOpen }: { onOpen: (m: Merchant) => void }) {
  const { client } = useSession();
  const { data, error, loading } = useAsync(() => client.merchants.list(), [client]);
  return (
    <section aria-label="Restaurants">
      <h2>Restaurants</h2>
      {loading && <p role="status">Loading…</p>}
      <ErrorBanner message={error} />
      {data?.length === 0 && <p className="muted">No restaurants are available yet.</p>}
      <ul>
        {data?.map((m) => (
          <li key={m.id}><span>{m.name}</span><button onClick={() => onOpen(m)}>View menu</button></li>
        ))}
      </ul>
    </section>
  );
}
