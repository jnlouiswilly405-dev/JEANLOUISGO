import { useState } from 'react';
import { ErrorBanner, useAsync, useSession } from '@multigo/app-shell';

const PAGE = 20;

export function BlockedOutbox() {
  const { client } = useSession();
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
      <h2>Blocked outbox events</h2>
      <form className="filters" onSubmit={(e) => { e.preventDefault(); setOffset(0); setApplied({ eventType: eventType.trim(), aggregateId: aggregateId.trim() }); }}>
        <label>Event type<input value={eventType} onChange={(e) => setEventType(e.target.value)} /></label>
        <label>Aggregate ID<input value={aggregateId} onChange={(e) => setAggregateId(e.target.value)} /></label>
        <button type="submit">Filter</button>
      </form>
      <ErrorBanner message={page.error} />
      {page.loading && <p className="muted">Loading…</p>}
      {d && d.items.length === 0 && <p className="muted">No blocked events.</p>}
      {d && d.items.length > 0 && (
        <table>
          <thead><tr><th>ID</th><th>Type</th><th>Aggregate</th><th>Status</th><th>Attempts</th><th>Created</th><th>Failure reason</th></tr></thead>
          <tbody>
            {d.items.map((e) => (
              <tr key={e.id}>
                <td>{e.id}</td><td>{e.eventType}</td><td>{e.aggregateType} {e.aggregateId}</td>
                <td>{e.status}</td><td>{e.attempts}</td><td>{e.createdAt}</td><td>{e.failureReason ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {d && (
        <div className="pager">
          <button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>Previous</button>
          <span>{d.total === 0 ? 0 : offset + 1}–{Math.min(offset + PAGE, d.total)} of {d.total}</span>
          <button disabled={offset + PAGE >= d.total} onClick={() => setOffset(offset + PAGE)}>Next</button>
        </div>
      )}
    </section>
  );
}
