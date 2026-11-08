import { useEffect } from 'react';
import { ErrorBanner, useAsync, useSession } from '@multigo/app-shell';
import { formatMoney } from '@multigo/api-client';

const TERMINAL = ['DELIVERED', 'CANCELLED', 'REFUNDED'];
const POLL_MS = 10_000;

export function OrderDetail({ id }: { id: string }) {
  const { client } = useSession();
  const order = useAsync(() => client.orders.get(id), [client, id]);
  const tracking = useAsync(() => client.orders.tracking(id), [client, id]);
  const status = order.data?.status;
  const { reload: reloadOrder } = order;
  const { reload: reloadTracking } = tracking;

  useEffect(() => {
    if (!status || TERMINAL.includes(status)) return;
    const t = setInterval(() => { reloadOrder(); reloadTracking(); }, POLL_MS);
    return () => clearInterval(t);
  }, [status, reloadOrder, reloadTracking]);

  const o = order.data;
  const last = tracking.data?.[0];
  return (
    <section aria-label="Order details">
      <h2>Order</h2>
      {order.loading && !o && <p role="status">Loading…</p>}
      <ErrorBanner message={order.error} />
      {o && (
        <>
          <p>Status: <strong>{o.status}</strong></p>
          {o.status === 'PENDING_PAYMENT' && <p className="muted">Awaiting payment. Card payment is not available in this build yet.</p>}
          <ul aria-label="Items">
            {o.items.map((i) => <li key={i.productId}><span>{i.quantity} × {i.name}</span><span>{formatMoney(i.unitPriceCents * i.quantity, o.currency)}</span></li>)}
          </ul>
          <p>Subtotal {formatMoney(o.subtotalCents, o.currency)} · Delivery {formatMoney(o.deliveryFeeCents, o.currency)} · <strong>Total {formatMoney(o.totalCents, o.currency)}</strong></p>
          {last ? <p>Driver last seen at {last.lat.toFixed(4)}, {last.lng.toFixed(4)} ({new Date(last.recorded_at).toLocaleTimeString()})</p> : <p className="muted">No driver location yet.</p>}
        </>
      )}
    </section>
  );
}
