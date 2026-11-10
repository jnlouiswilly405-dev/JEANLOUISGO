import { ErrorBanner, translateStatus, useAsync, useLocalization, useSession } from '@multigo/app-shell';
import { formatMoney } from '@multigo/api-client';

export function OrderList({ onOpen }: { onOpen: (id: string) => void }) {
  const { client } = useSession();
  const { locale, t } = useLocalization();
  const { data, error, loading } = useAsync(() => client.orders.list(), [client]);
  return (
    <section aria-label={t('myOrders')}>
      <h2>{t('myOrders')}</h2>
      {loading && <p role="status">{t('loading')}</p>}
      <ErrorBanner message={error} />
      {data?.length === 0 && <p className="muted">{t('noOrdersPlaced')}</p>}
      <ul>
        {data?.map((o) => (
          <li key={o.id}>
            <span>{new Date(o.createdAt).toLocaleString(locale)} · {formatMoney(o.totalCents, o.currency, locale)}</span>
            <span><em>{translateStatus(o.status, t)}</em> <button onClick={() => onOpen(o.id)}>{t('details')}</button></span>
          </li>
        ))}
      </ul>
    </section>
  );
}
