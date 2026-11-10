import { useState } from 'react';
import { ErrorBanner, useAsync, useLocalization, useSession } from '@multigo/app-shell';
import { formatMoney } from '@multigo/api-client';

const PAGE = 20;

export function Unreferenced() {
  const { client } = useSession();
  const { locale, t } = useLocalization();
  const [minutes, setMinutes] = useState('');
  const [applied, setApplied] = useState<number | undefined>();
  const [offset, setOffset] = useState(0);

  const page = useAsync(
    () => client.admin.unreferencedPayments({ limit: PAGE, offset, ...(applied !== undefined ? { olderThanMinutes: applied } : {}) }),
    [client, offset, applied],
  );
  const d = page.data;

  return (
    <section>
      <h2>{t('paymentsWithoutReference')}</h2>
      <p className="muted">{t('reportOnlyPayments')}</p>
      <form className="filters" onSubmit={(e) => {
        e.preventDefault();
        const n = Number(minutes);
        setOffset(0);
        setApplied(minutes.trim() !== '' && Number.isFinite(n) && n >= 0 ? n : undefined);
      }}>
        <label>{t('olderThanMinutes')}<input inputMode="numeric" value={minutes} onChange={(e) => setMinutes(e.target.value)} /></label>
        <button type="submit">{t('filter')}</button>
      </form>
      <ErrorBanner message={page.error} />
      {page.loading && <p className="muted">{t('loading')}</p>}
      {d && d.items.length === 0 && <p className="muted">{t('noUnreferencedPayments')}</p>}
      {d && d.items.length > 0 && (
        <table>
          <thead><tr><th>{t('payment')}</th><th>{t('order')}</th><th>{t('amount')}</th><th>{t('ageMinutes')}</th><th>{t('created')}</th></tr></thead>
          <tbody>
            {d.items.map((p) => (
              <tr key={p.paymentId}>
                <td>{p.paymentId}</td><td>{p.orderId}</td><td>{formatMoney(p.amountCents, p.currency, locale)}</td>
                <td>{new Intl.NumberFormat(locale).format(p.ageMinutes)}</td><td>{new Date(p.createdAt).toLocaleString(locale)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {d && (
        <div className="pager">
          <button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>{t('previous')}</button>
          <span>{t('rangeOfTotal', { start: d.total === 0 ? 0 : offset + 1, end: Math.min(offset + PAGE, d.total), total: d.total })}</span>
          <button disabled={offset + PAGE >= d.total} onClick={() => setOffset(offset + PAGE)}>{t('next')}</button>
        </div>
      )}
    </section>
  );
}
