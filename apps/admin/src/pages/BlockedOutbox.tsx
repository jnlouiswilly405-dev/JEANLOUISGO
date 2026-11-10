import { useState } from 'react';
import { ErrorBanner, translateStatus, useAsync, useLocalization, useSession } from '@multigo/app-shell';

const PAGE = 20;

export function BlockedOutbox() {
  const { client } = useSession();
  const { locale, t } = useLocalization();
  const [eventType, setEventType] = useState('');
  const [aggregateId, setAggregateId] = useState('');
  const [applied, setApplied] = useState({ eventType: '', aggregateId: '' });
  const [offset, setOffset] = useState(0);

  const page = useAsync(
    () => client.admin.blockedOutbox({
      limit: PAGE, offset,
      ...(applied.eventType ? { eventType: applied.eventType } : {}),
      ...(applied.aggregateId ? { aggregateId: applied.aggregateId } : {}),
    }),
    [client, offset, applied],
  );
  const d = page.data;

  return (
    <section>
      <h2>{t('blockedOutboxEvents')}</h2>
      <form className="filters" onSubmit={(e) => { e.preventDefault(); setOffset(0); setApplied({ eventType: eventType.trim(), aggregateId: aggregateId.trim() }); }}>
        <label>{t('eventType')}<input value={eventType} onChange={(e) => setEventType(e.target.value)} /></label>
        <label>{t('aggregateId')}<input value={aggregateId} onChange={(e) => setAggregateId(e.target.value)} /></label>
        <button type="submit">{t('filter')}</button>
      </form>
      <ErrorBanner message={page.error} />
      {page.loading && <p className="muted">{t('loading')}</p>}
      {d && d.items.length === 0 && <p className="muted">{t('noBlockedEvents')}</p>}
      {d && d.items.length > 0 && (
        <table>
          <thead><tr><th>{t('id')}</th><th>{t('type')}</th><th>{t('aggregate')}</th><th>{t('status')}</th><th>{t('attempts')}</th><th>{t('created')}</th><th>{t('failureReason')}</th></tr></thead>
          <tbody>
            {d.items.map((e) => (
              <tr key={e.id}>
                <td>{e.id}</td><td>{e.eventType}</td><td>{e.aggregateType} {e.aggregateId}</td>
                <td>{translateStatus(e.status, t)}</td><td>{new Intl.NumberFormat(locale).format(e.attempts)}</td><td>{new Date(e.createdAt).toLocaleString(locale)}</td><td>{e.failureReason ?? '—'}</td>
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
