import { ErrorBanner, useAsync, useLocalization, useSession } from '@multigo/app-shell';
import type { Merchant } from '@multigo/api-client';

export function MerchantList({ onOpen }: { onOpen: (m: Merchant) => void }) {
  const { client } = useSession();
  const { t } = useLocalization();
  const { data, error, loading } = useAsync(() => client.merchants.list(), [client]);
  return (
    <section aria-label={t('restaurants')}>
      <h2>{t('restaurants')}</h2>
      {loading && <p role="status">{t('loading')}</p>}
      <ErrorBanner message={error} />
      {data?.length === 0 && <p className="muted">{t('noRestaurants')}</p>}
      <ul>
        {data?.map((m) => (
          <li key={m.id}><span>{m.name}</span><button onClick={() => onOpen(m)}>{t('viewMenu')}</button></li>
        ))}
      </ul>
    </section>
  );
}
