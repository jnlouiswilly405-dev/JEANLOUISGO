import { useState } from 'react';
import { ErrorBanner, useAsync, useLocalization, useSession } from '@multigo/app-shell';
import { ApiError, formatMoney, type AdminPromoInput } from '@multigo/api-client';

const PAGE = 20;

export function Promotions() {
  const { client } = useSession();
  const { locale, t } = useLocalization();
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
    if (!Number.isFinite(n) || n <= 0) { setError(t('enterPositiveValue')); return; }
    const input: AdminPromoInput = { code: code.trim(), discountType: type };
    if (type === 'PERCENT') input.percent = n; else input.amountCents = Math.round(n * 100);
    if (limit.trim() !== '') input.usageLimit = Number(limit);
    try {
      await client.admin.promos.create(input);
      setCode(''); setValue(''); setLimit(''); setOffset(0); setRev((r) => r + 1);
    } catch (err) {
      setError(err instanceof ApiError ? String(err.message) : t('couldNotCreatePromotion'));
    }
  }

  async function toggle(id: string, active: boolean) {
    setError(null);
    try { await client.admin.promos.setActive(id, active); setRev((r) => r + 1); }
    catch (err) { setError(err instanceof ApiError ? String(err.message) : t('couldNotUpdatePromotion')); }
  }

  return (
    <section>
      <h2>{t('promotions')}</h2>
      <p className="muted">{t('promotionsPolicy')}</p>
      <form className="filters" onSubmit={submit}>
        <label>{t('code')}<input value={code} onChange={(e) => setCode(e.target.value)} /></label>
        <label>{t('type')}
          <select value={type} onChange={(e) => setType(e.target.value as 'PERCENT' | 'FIXED')}>
            <option value="PERCENT">{t('percent')}</option><option value="FIXED">{t('fixedAmount')}</option>
          </select>
        </label>
        <label>{type === 'PERCENT' ? t('percentRange') : t('amount')}<input inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} /></label>
        <label>{t('usageLimitOptional')}<input inputMode="numeric" value={limit} onChange={(e) => setLimit(e.target.value)} /></label>
        <button type="submit">{t('createPromotion')}</button>
      </form>
      <ErrorBanner message={error ?? page.error} />
      {page.loading && <p className="muted">{t('loading')}</p>}
      {d && d.items.length === 0 && <p className="muted">{t('noPromotions')}</p>}
      {d && d.items.length > 0 && (
        <table>
          <thead><tr><th>{t('code')}</th><th>{t('discountType')}</th><th>{t('used')}</th><th>{t('status')}</th><th /></tr></thead>
          <tbody>
            {d.items.map((p) => (
              <tr key={p.id}>
                <td>{p.code}</td>
                <td>{p.discountType === 'PERCENT' ? `${new Intl.NumberFormat(locale).format(p.percent ?? 0)}%` : formatMoney(p.amountCents ?? 0, 'USD', locale)}</td>
                <td>{new Intl.NumberFormat(locale).format(p.usedCount)}{p.usageLimit !== null ? ` / ${new Intl.NumberFormat(locale).format(p.usageLimit)}` : ''}</td>
                <td>{p.active ? t('active') : t('inactive')}</td>
                <td><button onClick={() => toggle(p.id, !p.active)}>{p.active ? t('deactivate') : t('activate')} {p.code}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {d && (
        <div className="pager">
          <button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>{t('previous')}</button>
          <span>{t('rangeOfTotal', { start: d.total === 0 ? 0 : offset + 1, end: offset + d.items.length, total: d.total })}</span>
          <button disabled={offset + d.items.length >= d.total} onClick={() => setOffset(offset + PAGE)}>{t('next')}</button>
        </div>
      )}
    </section>
  );
}
