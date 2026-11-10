import { ErrorBanner, ReviewList, useAsync, useLocalization, useSession } from '@multigo/app-shell';

export function Reviews() {
  const { client, user } = useSession();
  const { t } = useLocalization();
  const merchants = useAsync(() => client.merchants.list(), [client]);
  const mine = merchants.data?.filter((m) => m.owner_user_id === user?.id) ?? [];
  return (
    <section aria-label={t('customerReviews')}>
      <h2>{t('customerReviews')}</h2>
      {merchants.loading && !merchants.data && <p role="status">{t('loading')}</p>}
      <ErrorBanner message={merchants.error} />
      {merchants.data && mine.length === 0 && <p className="muted">{t('noRestaurantYet')}</p>}
      {mine.map((m) => <div key={m.id}><h3>{m.name}</h3><ReviewList merchantId={m.id} /></div>)}
    </section>
  );
}
