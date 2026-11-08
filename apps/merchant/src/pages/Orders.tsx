import { useEffect, useState } from 'react';
import { ErrorBanner, useAsync, useSession } from '@multigo/app-shell';
import { formatMoney, merchantNextStatus, type Order } from '@multigo/api-client';

const POLL_MS = 15_000;
const ACTION_LABEL = { ACCEPTED: 'Accept', PREPARING: 'Start preparing', READY: 'Mark ready' } as const;

function nextAction(o: Order) {
  const next = (merchantNextStatus as Record<string, keyof typeof ACTION_LABEL | undefined>)[o.status];
  return next ? { status: next, label: ACTION_LABEL[next] } : null;
}

export function Orders() {
  const { client } = useSession();
  const orders = useAsync(() => client.orders.list(), [client]);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const { reload } = orders;

  useEffect(() => {
    const t = setInterval(reload, POLL_MS);
    return () => clearInterval(t);
  }, [reload]);

  async function advance(o: Order, status: keyof typeof ACTION_LABEL) {
    setBusyId(o.id);
    setActionError(null);
    try { await client.orders.setStatus(o.id, status); reload(); }
    catch (e) { setActionError(e instanceof Error ? e.message : 'Update failed'); }
    finally { setBusyId(null); }
  }

  return (
    <section aria-label="Orders">
      <h2>Orders</h2>
      {orders.loading && !orders.data && <p role="status">Loading…</p>}
      <ErrorBanner message={orders.error ?? actionError} />
      {orders.data?.length === 0 && <p className="muted">No orders yet.</p>}
      <ul>
        {orders.data?.map((o) => {
          const action = nextAction(o);
          return (
            <li key={o.id}>
              <span>#{o.id.slice(0, 8)} · {formatMoney(o.totalCents, o.currency)} · <em>{o.status}</em></span>
              {action && <button disabled={busyId === o.id} onClick={() => advance(o, action.status)}>{action.label}</button>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
