import { ErrorBanner, useAsync, useSession } from '@multigo/app-shell';
import { formatMoney, netAmountCents, type Merchant } from '@multigo/api-client';

function MerchantSettlements({ merchant }: { merchant: Merchant }) {
  const { client } = useSession();
  const rows = useAsync(() => client.finance.merchantSettlements(merchant.id), [client, merchant.id]);
  return (
    <section aria-label={`${merchant.name} settlements`}>
      <h3>{merchant.name}</h3>
      {rows.loading && !rows.data && <p role="status">Loading…</p>}
      <ErrorBanner message={rows.error} />
      {rows.data && rows.data.length === 0 && <p className="muted">No eligible settlements.</p>}
      <ul>
        {rows.data?.map((s) => {
          const cents = netAmountCents(s);
          return (
            <li key={s.id}>
              <span>Order #{s.order_id.slice(0, 8)} · {new Date(s.created_at).toLocaleDateString()}</span>
              <span>{cents === null ? '—' : formatMoney(cents)} · <em>{s.status}</em></span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Read-only. The backend lists only ELIGIBLE settlements; nothing here creates, approves or pays them. */
export function Settlements() {
  const { client, user } = useSession();
  const merchants = useAsync(() => client.merchants.list(), [client]);
  const mine = merchants.data?.filter((m) => m.owner_user_id === user?.id) ?? [];
  return (
    <section aria-label="Settlements">
      <h2>Settlements</h2>
      <p className="muted">Read-only view. Payouts are not enabled, and the settlement policy has not been decided.</p>
      {merchants.loading && !merchants.data && <p role="status">Loading…</p>}
      <ErrorBanner message={merchants.error} />
      {merchants.data && mine.length === 0 && <p className="muted">You do not have a restaurant yet.</p>}
      {mine.map((m) => <MerchantSettlements key={m.id} merchant={m} />)}
    </section>
  );
}
