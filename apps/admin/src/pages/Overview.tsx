import { ErrorBanner, useAsync, useSession } from '@multigo/app-shell';
import { translateStatus, useLocalization, type TranslationKey } from '@multigo/app-shell';

const show = (v: unknown) => (v !== null && typeof v === 'object' ? JSON.stringify(v) : String(v ?? ''));

export function Overview() {
  const { client } = useSession();
  const { locale, t } = useLocalization();
  const health = useAsync(() => client.admin.health(), [client]);
  const summary = useAsync(() => client.admin.financialSummary(), [client]);
  const rows = summary.data ?? [];
  const columns = rows.length ? Object.keys(rows[0]) : [];

  return (
    <>
      <section>
        <h2>{t('systemHealth')}</h2>
        <ErrorBanner message={health.error} />
        {health.data && (
          <p>{t('database')}: <strong>{translateStatus(health.data.database, t)}</strong> · {t('latency')} {new Intl.NumberFormat(locale).format(health.data.latencyMs)} ms · {t('checked')} {new Date(health.data.checkedAt).toLocaleString(locale)}</p>
        )}
      </section>
      <section>
        <h2>{t('financialSummary')}</h2>
        <ErrorBanner message={summary.error} />
        {summary.loading && <p className="muted">{t('loading')}</p>}
        {!summary.loading && !summary.error && rows.length === 0 && <p className="muted">{t('noLedgerActivity')}</p>}
        {rows.length > 0 && (
          <table>
            <thead><tr>{columns.map((c) => <th key={c}>{columnLabel(c, t)}</th>)}</tr></thead>
            <tbody>
              {rows.map((r, i) => <tr key={i}>{columns.map((c) => <td key={c}>{show(r[c])}</td>)}</tr>)}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}

const columnKeys: Partial<Record<string, TranslationKey>> = {
  currency: 'currency',
  payment_count: 'payments',
  captured_count: 'payments',
  total_cents: 'total',
  amount_cents: 'amount',
  status: 'status',
};

function columnLabel(column: string, t: ReturnType<typeof useLocalization>['t']): string {
  const key = columnKeys[column];
  return key ? t(key) : column;
}
