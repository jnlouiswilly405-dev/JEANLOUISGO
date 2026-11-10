import { ErrorBanner, translateStatus, useAsync, useLocalization, useSession } from '@multigo/app-shell';
import { formatMoney, netAmountCents, type Merchant } from '@multigo/api-client';

function MerchantSettlements({ merchant }: { merchant: Merchant }) {
  const { client } = useSession();
  const { locale, t } = useLocalization();
  const rows = useAsync(() => client.finance.merchantSettlements(merchant.id), [client, merchant.id]);
  return (
    <section aria-label={`${merchant.name} settlements`}>
      <h3>{merchant.name}</h3>
      {rows.loading && !rows.data && <p role="status">{t('loading')}</p>}
      <ErrorBanner message={rows.error} />
      {rows.data && rows.data.length === 0 && <p className="muted">{t('noEligibleSettlements')}</p>}
      <ul>
        {rows.data?.map((s) => {
          const cents = netAmountCents(s);
          return (
            <li key={s.id}>
              <span>{t('orderNumber', { id: s.order_id.slice(0, 8) })} · {new Date(s.created_at).toLocaleDateString(locale)}</span>
              <span>{cents === null ? '—' : formatMoney(cents, 'USD', locale)} · <em>{translateStatus(s.status, t)}</em></span>
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
  const { t } = useLocalization();
  const merchants = useAsync(() => client.merchants.list(), [client]);
  const mine = merchants.data?.filter((m) => m.owner_user_id === user?.id) ?? [];
  return (
    <section aria-label={t('settlements')}>
      <h2>{t('settlements')}</h2>
      <p className="muted">{t('settlementsReadOnly')}</p>
      {merchants.loading && !merchants.data && <p role="status">{t('loading')}</p>}
      <ErrorBanner message={merchants.error} />
      {merchants.data && mine.length === 0 && <p className="muted">{t('noRestaurantYet')}</p>}
      {mine.map((m) => <MerchantSettlements key={m.id} merchant={m} />)}
    </section>
  );
}
