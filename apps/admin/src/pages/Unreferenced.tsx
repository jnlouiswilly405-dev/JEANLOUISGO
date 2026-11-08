import { useState } from 'react';
import { ErrorBanner, useAsync, useSession } from '@multigo/app-shell';
import { formatMoney } from '@multigo/api-client';

const PAGE = 20;

export function Unreferenced() {
  const { client } = useSession();
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
      <h2>Payments without provider reference</h2>
      <p className="muted">Report only. No action here changes payments or orders.</p>
      <form className="filters" onSubmit={(e) => {
        e.preventDefault();
        const n = Number(minutes);
        setOffset(0);
        setApplied(minutes.trim() !== '' && Number.isFinite(n) && n >= 0 ? n : undefined);
      }}>
        <label>Older than (minutes)<input inputMode="numeric" value={minutes} onChange={(e) => setMinutes(e.target.value)} /></label>
        <button type="submit">Filter</button>
      </form>
      <ErrorBanner message={page.error} />
      {page.loading && <p className="muted">Loading…</p>}
      {d && d.items.length === 0 && <p className="muted">No unreferenced payments.</p>}
      {d && d.items.length > 0 && (
        <table>
          <thead><tr><th>Payment</th><th>Order</th><th>Amount</th><th>Age (min)</th><th>Created</th></tr></thead>
          <tbody>
            {d.items.map((p) => (
              <tr key={p.paymentId}>
                <td>{p.paymentId}</td><td>{p.orderId}</td><td>{formatMoney(p.amountCents, p.currency)}</td>
                <td>{p.ageMinutes}</td><td>{p.createdAt}</td>
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
