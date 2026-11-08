import { useEffect, useState } from 'react';
import { AuthGate, ErrorBanner, useAsync, useSession } from '@multigo/app-shell';
import { formatMoney, type Order } from '@multigo/api-client';
import { ACTIVE_STATUSES, nextDriverAction } from './actions.js';
import { useLocationSharing, type GeoLike } from './useLocationSharing.js';

const POLL_MS = 10_000;

function OrderCard({ order, onChanged, geolocation }: { order: Order; onChanged: () => void; geolocation?: GeoLike | null }) {
  const { client } = useSession();
  const action = nextDriverAction(order.status);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const active = ACTIVE_STATUSES.includes(order.status);
  const driverProfileId = order.driverId;

  const location = useLocationSharing({
    enabled: sharing && active && !!driverProfileId,
    geolocation,
    send: (p) => client.drivers.sendLocation(driverProfileId!, { ...p, orderId: order.id }),
  });

  async function run() {
    if (!action) return;
    setBusy(true);
    setError(null);
    try {
      if (action.kind === 'status') await client.orders.setStatus(order.id, action.status);
      else await client.orders.advanceDelivery(order.id, action.action);
      onChanged();
    } catch (e) { setError(e instanceof Error ? e.message : 'Update failed'); }
    finally { setBusy(false); }
  }

  return (
    <li aria-label={`Order ${order.id.slice(0, 8)}`}>
      <span>#{order.id.slice(0, 8)} · {formatMoney(order.totalCents, order.currency)} · <em>{order.status}</em></span>
      <span>
        {active && driverProfileId && (
          <label><input type="checkbox" checked={sharing} onChange={(e) => setSharing(e.target.checked)} /> Share location</label>
        )}
        {action && <button disabled={busy} onClick={run}>{action.label}</button>}
      </span>
      <ErrorBanner message={error ?? location.error} />
    </li>
  );
}

function Deliveries({ geolocation }: { geolocation?: GeoLike | null }) {
  const { client } = useSession();
  const orders = useAsync(() => client.orders.list(), [client]);
  const { reload } = orders;
  useEffect(() => {
    const t = setInterval(reload, POLL_MS);
    return () => clearInterval(t);
  }, [reload]);

  const mine = orders.data ?? [];
  const current = mine.filter((o) => ACTIVE_STATUSES.includes(o.status));
  const past = mine.filter((o) => !ACTIVE_STATUSES.includes(o.status));
  return (
    <main>
      <h2>Current deliveries</h2>
      {orders.loading && !orders.data && <p role="status">Loading…</p>}
      <ErrorBanner message={orders.error} />
      {orders.data && current.length === 0 && <p className="muted">No active deliveries.</p>}
      <ul aria-label="Current deliveries">{current.map((o) => <OrderCard key={o.id} order={o} onChanged={reload} geolocation={geolocation} />)}</ul>
      {past.length > 0 && (
        <>
          <h2>History</h2>
          <ul aria-label="History">{past.map((o) => <li key={o.id}><span>#{o.id.slice(0, 8)} · {formatMoney(o.totalCents, o.currency)}</span><em>{o.status}</em></li>)}</ul>
        </>
      )}
    </main>
  );
}

function Shell({ geolocation }: { geolocation?: GeoLike | null }) {
  const { user, logout } = useSession();
  return (
    <>
      <header>
        <strong>MULTIGO Driver</strong>
        <span style={{ flex: 1 }} />
        <span className="muted">{user?.displayName}</span>
        <button onClick={logout}>Sign out</button>
      </header>
      <Deliveries geolocation={geolocation} />
    </>
  );
}

export function App({ geolocation }: { geolocation?: GeoLike | null } = {}) {
  return <AuthGate title="MULTIGO Driver — Sign in"><Shell geolocation={geolocation} /></AuthGate>;
}
