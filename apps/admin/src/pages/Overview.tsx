import { ErrorBanner, useAsync, useSession } from '@multigo/app-shell';

const show = (v: unknown) => (v !== null && typeof v === 'object' ? JSON.stringify(v) : String(v ?? ''));

export function Overview() {
  const { client } = useSession();
  const health = useAsync(() => client.admin.health(), [client]);
  const summary = useAsync(() => client.admin.financialSummary(), [client]);
  const rows = summary.data ?? [];
  const columns = rows.length ? Object.keys(rows[0]) : [];

  return (
    <>
      <section>
        <h2>System health</h2>
        <ErrorBanner message={health.error} />
        {health.data && (
          <p>Database: <strong>{health.data.database}</strong> · latency {health.data.latencyMs} ms · checked {health.data.checkedAt}</p>
        )}
      </section>
      <section>
        <h2>Financial summary (read-only)</h2>
        <ErrorBanner message={summary.error} />
        {summary.loading && <p className="muted">Loading…</p>}
        {!summary.loading && !summary.error && rows.length === 0 && <p className="muted">No ledger activity.</p>}
        {rows.length > 0 && (
          <table>
            <thead><tr>{columns.map((c) => <th key={c}>{c}</th>)}</tr></thead>
            <tbody>
              {rows.map((r, i) => <tr key={i}>{columns.map((c) => <td key={c}>{show(r[c])}</td>)}</tr>)}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
