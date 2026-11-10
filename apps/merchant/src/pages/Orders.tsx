import { useEffect, useState } from 'react';
import { ChatToggle, ErrorBanner, translateStatus, useAsync, useLocalization, useSession } from '@multigo/app-shell';
import { formatMoney, merchantNextStatus, type Order } from '@multigo/api-client';

const CHAT_STATUSES = ['PAID', 'ACCEPTED', 'PREPARING', 'READY', 'ASSIGNED', 'PICKED_UP', 'IN_TRANSIT', 'DELIVERED'];
const POLL_MS = 15_000;
const ACTION_LABEL = { ACCEPTED: 'accept', PREPARING: 'startPreparing', READY: 'markReady' } as const;

function nextAction(o: Order) {
  const next = (merchantNextStatus as Record<string, keyof typeof ACTION_LABEL | undefined>)[o.status];
  return next ? { status: next, label: ACTION_LABEL[next] } : null;
}

export function Orders() {
  const { client } = useSession();
  const { locale, t } = useLocalization();
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
    catch (e) { setActionError(e instanceof Error ? e.message : t('updateFailed')); }
    finally { setBusyId(null); }
  }

  return (
    <section aria-label={t('orders')}>
      <h2>{t('orders')}</h2>
      {orders.loading && !orders.data && <p role="status">{t('loading')}</p>}
      <ErrorBanner message={orders.error ?? actionError} />
      {orders.data?.length === 0 && <p className="muted">{t('noOrdersYet')}</p>}
      <ul>
        {orders.data?.map((o) => {
          const action = nextAction(o);
          return (
            <li key={o.id}>
              <span>#{o.id.slice(0, 8)} · {formatMoney(o.totalCents, o.currency, locale)} · <em>{translateStatus(o.status, t)}</em></span>
              {action && <button disabled={busyId === o.id} onClick={() => advance(o, action.status)}>{t(action.label)}</button>}
              {CHAT_STATUSES.includes(o.status) && <ChatToggle orderId={o.id} />}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
