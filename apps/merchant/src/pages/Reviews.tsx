import { ErrorBanner, ReviewList, useAsync, useSession } from '@multigo/app-shell';

export function Reviews() {
  const { client, user } = useSession();
  const merchants = useAsync(() => client.merchants.list(), [client]);
  const mine = merchants.data?.filter((m) => m.owner_user_id === user?.id) ?? [];
  return (
    <section aria-label="Customer reviews">
      <h2>Customer reviews</h2>
      {merchants.loading && !merchants.data && <p role="status">Loading…</p>}
      <ErrorBanner message={merchants.error} />
      {merchants.data && mine.length === 0 && <p className="muted">You do not have a restaurant yet.</p>}
      {mine.map((m) => <div key={m.id}><h3>{m.name}</h3><ReviewList merchantId={m.id} /></div>)}
    </section>
  );
}
