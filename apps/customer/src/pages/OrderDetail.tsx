import { useEffect } from 'react';
import { ChatToggle, ErrorBanner, translateStatus, useAsync, useLocalization, useSession } from '@multigo/app-shell';
import { formatMoney } from '@multigo/api-client';
import { PaymentStep } from './PaymentStep.js';
import { ReviewForm } from './ReviewForm.js';

const CHAT_STATUSES = ['PAID', 'ACCEPTED', 'PREPARING', 'READY', 'ASSIGNED', 'PICKED_UP', 'IN_TRANSIT', 'DELIVERED'];
const TERMINAL = ['DELIVERED', 'CANCELLED', 'REFUNDED'];
const POLL_MS = 10_000;

export function OrderDetail({ id }: { id: string }) {
  const { client } = useSession();
  const { locale, t } = useLocalization();
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
    <section aria-label={t('orderDetails')}>
      <h2>{t('order')}</h2>
      {order.loading && !o && <p role="status">{t('loading')}</p>}
      <ErrorBanner message={order.error} />
      {o && (
        <>
          <p>{t('status')}: <strong>{translateStatus(o.status, t)}</strong></p>
          {o.deliveryAddress && (
            <p>
              <strong>{t('deliveryAddress')}:</strong> {o.deliveryAddress.line1}
              {o.deliveryAddress.line2 ? `, ${o.deliveryAddress.line2}` : ''}
              {`, ${o.deliveryAddress.city}, ${o.deliveryAddress.stateCode} ${o.deliveryAddress.postalCode}`}
            </p>
          )}
          {o.status === 'PENDING_PAYMENT' && <PaymentStep orderId={o.id} amountCents={o.totalCents} onSubmitted={reloadOrder} />}
          <ul aria-label={t('items')}>
            {o.items.map((i) => <li key={i.productId}><span>{i.quantity} × {i.name}</span><span>{formatMoney(i.unitPriceCents * i.quantity, o.currency, locale)}</span></li>)}
          </ul>
          <p>{t('subtotal')} {formatMoney(o.subtotalCents, o.currency, locale)} · {t('delivery')} {formatMoney(o.deliveryFeeCents, o.currency, locale)} · {o.discountCents ? <>{t('discount')} −{formatMoney(o.discountCents, o.currency, locale)} · </> : null}<strong>{t('total')} {formatMoney(o.totalCents, o.currency, locale)}</strong></p>
          {CHAT_STATUSES.includes(o.status) && <ChatToggle orderId={o.id} />}
          {o.status === 'DELIVERED' && <ReviewForm orderId={o.id} merchantId={o.merchantId} />}
          {last ? <p>{t('driverLastSeen', { lat: last.lat.toFixed(4), lng: last.lng.toFixed(4), time: new Date(last.recorded_at).toLocaleTimeString(locale) })}</p> : <p className="muted">{t('noDriverLocation')}</p>}
        </>
      )}
    </section>
  );
}
