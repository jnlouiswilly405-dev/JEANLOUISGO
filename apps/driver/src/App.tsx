import { useEffect, useState } from 'react';
import { AuthGate, ChatToggle, ErrorBanner, NotificationsPanel, translateStatus, useAsync, useDocumentTitle, useLocalization, useSession } from '@multigo/app-shell';
import { formatMoney, netAmountCents, type Order } from '@multigo/api-client';
import { ACTIVE_STATUSES, nextDriverAction } from './actions.js';
import { useLocationSharing, type GeoLike } from './useLocationSharing.js';

const POLL_MS = 10_000;

function OrderCard({ order, onChanged, geolocation }: { order: Order; onChanged: () => void; geolocation?: GeoLike | null }) {
  const { client } = useSession();
  const { locale, t } = useLocalization();
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
    } catch (e) { setError(e instanceof Error ? e.message : t('updateFailed')); }
    finally { setBusy(false); }
  }

  return (
    <li aria-label={t('orderNumber', { id: order.id.slice(0, 8) })}>
      <span>#{order.id.slice(0, 8)} · {formatMoney(order.totalCents, order.currency, locale)} · <em>{translateStatus(order.status, t)}</em></span>
      <span>
        {active && driverProfileId && (
          <label><input type="checkbox" checked={sharing} onChange={(e) => setSharing(e.target.checked)} /> {t('shareLocation')}</label>
        )}
        {action && <button disabled={busy} onClick={run}>{t(action.label)}</button>}
      </span>
      {active && <ChatToggle orderId={order.id} />}
      <ErrorBanner message={error ?? location.error} />
    </li>
  );
}

function Deliveries({ geolocation }: { geolocation?: GeoLike | null }) {
  const { client } = useSession();
  const { locale, t } = useLocalization();
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
      <h2>{t('currentDeliveries')}</h2>
      {orders.loading && !orders.data && <p role="status">{t('loading')}</p>}
      <ErrorBanner message={orders.error} />
      {orders.data && current.length === 0 && <p className="muted">{t('noActiveDeliveries')}</p>}
      <ul aria-label={t('currentDeliveries')}>{current.map((o) => <OrderCard key={o.id} order={o} onChanged={reload} geolocation={geolocation} />)}</ul>
      {past.length > 0 && (
        <>
          <h2>{t('history')}</h2>
          <ul aria-label={t('history')}>{past.map((o) => <li key={o.id}><span>#{o.id.slice(0, 8)} · {formatMoney(o.totalCents, o.currency, locale)}</span><em>{translateStatus(o.status, t)}</em></li>)}</ul>
        </>
      )}
    </main>
  );
}

function Earnings() {
  const { client } = useSession();
  const { locale, t } = useLocalization();
  const orders = useAsync(() => client.orders.list(), [client]);
  // The only place the API reveals a driver profile id is an assigned order.
  const profileId = orders.data?.find((o) => o.driverId)?.driverId;
  const rows = useAsync(() => (profileId ? client.finance.driverEarnings(profileId) : Promise.resolve([])), [client, profileId]);
  return (
    <main aria-label={t('earnings')}>
      <h2>{t('earnings')}</h2>
      <p className="muted">{t('earningsReadOnly')}</p>
      {(orders.loading || rows.loading) && !rows.data && <p role="status">{t('loading')}</p>}
      <ErrorBanner message={orders.error ?? rows.error} />
      {orders.data && !profileId && <p className="muted">{t('earningsAfterAssignment')}</p>}
      {profileId && rows.data && rows.data.length === 0 && <p className="muted">{t('noEligibleEarnings')}</p>}
      <ul>
        {rows.data?.map((e) => {
          const cents = netAmountCents(e);
          return (
            <li key={e.id}>
              <span>{t('orderNumber', { id: e.order_id.slice(0, 8) })} · {new Date(e.created_at).toLocaleDateString(locale)}</span>
              <span>{cents === null ? '—' : formatMoney(cents, 'USD', locale)} · <em>{translateStatus(e.status, t)}</em></span>
            </li>
          );
        })}
      </ul>
    </main>
  );
}

const TABS = { deliveries: 'currentDeliveries', earnings: 'earnings', notifications: 'notifications' } as const;
type Tab = keyof typeof TABS;

function Shell({ geolocation }: { geolocation?: GeoLike | null }) {
  const { user, logout } = useSession();
  const { t } = useLocalization();
  const [tab, setTab] = useState<Tab>('deliveries');
  return (
    <>
      <header>
        <strong>{t('driverAppTitle')}</strong>
        <nav aria-label={t('main')}>
          {(Object.keys(TABS) as Tab[]).map((tab) => <button key={tab} onClick={() => setTab(tab)}>{t(TABS[tab])}</button>)}
        </nav>
        <span style={{ flex: 1 }} />
        <span className="muted">{user?.displayName}</span>
        <button onClick={logout}>{t('signOut')}</button>
      </header>
      {tab === 'deliveries' && <Deliveries geolocation={geolocation} />}
      {tab === 'earnings' && <Earnings />}
      {tab === 'notifications' && <main><NotificationsPanel /></main>}
    </>
  );
}

export function App({ geolocation }: { geolocation?: GeoLike | null } = {}) {
  const { t } = useLocalization();
  useDocumentTitle('driverAppTitle');
  return <AuthGate title={t('driverSignInTitle')}><Shell geolocation={geolocation} /></AuthGate>;
}
