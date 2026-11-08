import { useState } from 'react';
import { ErrorBanner, useAsync, useSession } from '@multigo/app-shell';
import { ApiError, formatMoney, type AdminPromoInput } from '@multigo/api-client';

const PAGE = 20;

export function Promotions() {
  const { client } = useSession();
  const [offset, setOffset] = useState(0);
  const [rev, setRev] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [type, setType] = useState<'PERCENT' | 'FIXED'>('PERCENT');
  const [value, setValue] = useState('');
  const [limit, setLimit] = useState('');

  const page = useAsync(() => client.admin.promos.list({ limit: PAGE, offset }), [client, offset, rev]);
  const d = page.data;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) { setError('Enter a positive value.'); return; }
    const input: AdminPromoInput = { code: code.trim(), discountType: type };
    if (type === 'PERCENT') input.percent = n; else input.amountCents = Math.round(n * 100);
    if (limit.trim() !== '') input.usageLimit = Number(limit);
    try {
      await client.admin.promos.create(input);
      setCode(''); setValue(''); setLimit(''); setOffset(0); setRev((r) => r + 1);
    } catch (err) {
      setError(err instanceof ApiError ? String(err.message) : 'Could not create promotion.');
    }
  }

  async function toggle(id: string, active: boolean) {
    setError(null);
    try { await client.admin.promos.setActive(id, active); setRev((r) => r + 1); }
    catch (err) { setError(err instanceof ApiError ? String(err.message) : 'Could not update promotion.'); }
  }

  return (
    <section>
      <h2>Promotions</h2>
      <p className="muted">Promotions are platform-funded by default. Merchant-funded promotions and their settlement treatment await an approved policy.</p>
      <form className="filters" onSubmit={submit}>
        <label>Code<input value={code} onChange={(e) => setCode(e.target.value)} /></label>
        <label>Type
          <select value={type} onChange={(e) => setType(e.target.value as 'PERCENT' | 'FIXED')}>
            <option value="PERCENT">Percent</option><option value="FIXED">Fixed amount</option>
          </select>
        </label>
        <label>{type === 'PERCENT' ? 'Percent (1–100)' : 'Amount'}<input inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} /></label>
        <label>Usage limit (optional)<input inputMode="numeric" value={limit} onChange={(e) => setLimit(e.target.value)} /></label>
        <button type="submit">Create promotion</button>
      </form>
      <ErrorBanner message={error ?? page.error} />
      {page.loading && <p className="muted">Loading…</p>}
      {d && d.items.length === 0 && <p className="muted">No promotions.</p>}
      {d && d.items.length > 0 && (
        <table>
          <thead><tr><th>Code</th><th>Discount</th><th>Used</th><th>Status</th><th /></tr></thead>
          <tbody>
            {d.items.map((p) => (
              <tr key={p.id}>
                <td>{p.code}</td>
                <td>{p.discountType === 'PERCENT' ? `${p.percent}%` : formatMoney(p.amountCents ?? 0, 'USD')}</td>
                <td>{p.usedCount}{p.usageLimit !== null ? ` / ${p.usageLimit}` : ''}</td>
                <td>{p.active ? 'Active' : 'Inactive'}</td>
                <td><button onClick={() => toggle(p.id, !p.active)}>{p.active ? 'Deactivate' : 'Activate'} {p.code}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {d && (
        <div className="pager">
          <button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>Previous</button>
          <span>{d.total === 0 ? '0' : `${offset + 1}–${offset + d.items.length}`} of {d.total}</span>
          <button disabled={offset + d.items.length >= d.total} onClick={() => setOffset(offset + PAGE)}>Next</button>
        </div>
      )}
    </section>
  );
}
