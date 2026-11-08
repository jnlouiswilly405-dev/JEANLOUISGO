import { useState, type FormEvent } from 'react';
import { ErrorBanner, useAsync, useSession } from '@multigo/app-shell';
import { formatMoney, type Merchant } from '@multigo/api-client';
import { parsePriceToCents } from '../price.js';

function CreateRestaurant({ onCreated }: { onCreated: () => void }) {
  const { client } = useSession();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try { await client.merchants.create(name.trim()); onCreated(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not create restaurant'); }
  }
  return (
    <form onSubmit={submit} aria-label="Create restaurant">
      <p>You do not have a restaurant yet.</p>
      <label>Restaurant name<input value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={160} /></label>
      <ErrorBanner message={error} />
      <button type="submit">Create restaurant</button>
    </form>
  );
}

function ProductManager({ merchant }: { merchant: Merchant }) {
  const { client } = useSession();
  const products = useAsync(() => client.merchants.products(merchant.id), [client, merchant.id]);
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const priceCents = parsePriceToCents(price);
    if (priceCents === null) { setError('Enter a valid price such as 12.50'); return; }
    try {
      await client.merchants.createProduct({ merchantId: merchant.id, name: name.trim(), description: description.trim() || undefined, priceCents });
      setName(''); setPrice(''); setDescription('');
      products.reload();
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not add item'); }
  }

  return (
    <>
      <h3>{merchant.name}</h3>
      {products.loading && !products.data && <p role="status">Loading…</p>}
      <ErrorBanner message={products.error} />
      {products.data?.length === 0 && <p className="muted">No menu items yet.</p>}
      <ul aria-label="Menu items">
        {products.data?.map((p) => <li key={p.id}><span>{p.name}</span><span>{formatMoney(p.price_cents)}</span></li>)}
      </ul>
      <form onSubmit={submit} aria-label="Add menu item">
        <label>Item name<input value={name} onChange={(e) => setName(e.target.value)} required maxLength={200} /></label>
        <label>Price (USD)<input value={price} onChange={(e) => setPrice(e.target.value)} required inputMode="decimal" /></label>
        <label>Description<input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} /></label>
        <ErrorBanner message={error} />
        <button type="submit">Add item</button>
      </form>
    </>
  );
}

export function Menu() {
  const { client, user } = useSession();
  const merchants = useAsync(() => client.merchants.list(), [client]);
  const mine = merchants.data?.filter((m) => m.owner_user_id === user?.id) ?? [];
  return (
    <section aria-label="Menu">
      <h2>Menu</h2>
      {merchants.loading && !merchants.data && <p role="status">Loading…</p>}
      <ErrorBanner message={merchants.error} />
      {merchants.data && mine.length === 0 && <CreateRestaurant onCreated={merchants.reload} />}
      {mine.map((m) => <ProductManager key={m.id} merchant={m} />)}
    </section>
  );
}
