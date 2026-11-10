import { useState, type FormEvent } from 'react';
import { ErrorBanner, useAsync, useLocalization, useSession } from '@multigo/app-shell';
import { formatMoney, type Merchant } from '@multigo/api-client';
import { parsePriceToCents } from '../price.js';

function CreateRestaurant({ onCreated }: { onCreated: () => void }) {
  const { client } = useSession();
  const { t } = useLocalization();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try { await client.merchants.create(name.trim()); onCreated(); }
    catch (err) { setError(err instanceof Error ? err.message : t('couldNotCreateRestaurant')); }
  }
  return (
    <form onSubmit={submit} aria-label={t('createRestaurantAria')}>
      <p>{t('noRestaurantYet')}</p>
      <label>{t('restaurantName')}<input value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={160} /></label>
      <ErrorBanner message={error} />
      <button type="submit">{t('createRestaurant')}</button>
    </form>
  );
}

function ProductManager({ merchant }: { merchant: Merchant }) {
  const { client } = useSession();
  const { locale, t } = useLocalization();
  const products = useAsync(() => client.merchants.products(merchant.id), [client, merchant.id]);
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const priceCents = parsePriceToCents(price);
    if (priceCents === null) { setError(t('validPrice')); return; }
    try {
      await client.merchants.createProduct({ merchantId: merchant.id, name: name.trim(), description: description.trim() || undefined, priceCents });
      setName(''); setPrice(''); setDescription('');
      products.reload();
    } catch (err) { setError(err instanceof Error ? err.message : t('couldNotAddItem')); }
  }

  return (
    <>
      <h3>{merchant.name}</h3>
      {products.loading && !products.data && <p role="status">{t('loading')}</p>}
      <ErrorBanner message={products.error} />
      {products.data?.length === 0 && <p className="muted">{t('noMenuItems')}</p>}
      <ul aria-label={t('menuItems')}>
        {products.data?.map((p) => <li key={p.id}><span>{p.name}</span><span>{formatMoney(p.price_cents, 'USD', locale)}</span></li>)}
      </ul>
      <form onSubmit={submit} aria-label={t('addMenuItem')}>
        <label>{t('itemName')}<input value={name} onChange={(e) => setName(e.target.value)} required maxLength={200} /></label>
        <label>{t('priceUsd')}<input value={price} onChange={(e) => setPrice(e.target.value)} required inputMode="decimal" /></label>
        <label>{t('description')}<input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} /></label>
        <ErrorBanner message={error} />
        <button type="submit">{t('addItem')}</button>
      </form>
    </>
  );
}

export function Menu() {
  const { client, user } = useSession();
  const { t } = useLocalization();
  const merchants = useAsync(() => client.merchants.list(), [client]);
  const mine = merchants.data?.filter((m) => m.owner_user_id === user?.id) ?? [];
  return (
    <section aria-label={t('menu')}>
      <h2>{t('menu')}</h2>
      {merchants.loading && !merchants.data && <p role="status">{t('loading')}</p>}
      <ErrorBanner message={merchants.error} />
      {merchants.data && mine.length === 0 && <CreateRestaurant onCreated={merchants.reload} />}
      {mine.map((m) => <ProductManager key={m.id} merchant={m} />)}
    </section>
  );
}
