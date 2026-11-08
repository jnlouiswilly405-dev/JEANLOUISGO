import { useState } from 'react';
import { ErrorBanner, ReviewList, useAsync, useSession } from '@multigo/app-shell';
import { formatMoney, type Merchant } from '@multigo/api-client';
import { addToCart, cartSubtotalCents, cartToOrderItems, setQuantity, type Cart } from '../cart.js';
import { PromoPreview } from './PromoPreview.js';

export function Menu({ merchant, onOrdered }: { merchant: Merchant; onOrdered: (orderId: string) => void }) {
  const { client } = useSession();
  const { data: products, error, loading } = useAsync(() => client.merchants.products(merchant.id), [client, merchant.id]);
  const [cart, setCart] = useState<Cart>({});
  const [placing, setPlacing] = useState(false);
  const [orderError, setOrderError] = useState<string | null>(null);
  const [promoCode, setPromoCode] = useState<string | null>(null);
  const lines = Object.values(cart);

  async function placeOrder() {
    setPlacing(true);
    setOrderError(null);
    try {
      const order = await client.orders.create({ merchantId: merchant.id, items: cartToOrderItems(cart), ...(promoCode ? { promoCode } : {}) });
      onOrdered(order.id);
    } catch (e) {
      const text = e instanceof Error ? e.message : '';
      setOrderError(
        text.includes('PROMO_ALREADY_USED') ? 'You have already used this promo code. Remove it to place the order.'
        : text.includes('PROMO_NOT_APPLICABLE') ? 'This promo code cannot be applied to this order.'
        : text.includes('PROMO_INVALID') ? 'This promo code is no longer valid for this order.'
        : text || 'Could not place the order',
      );
    } finally {
      setPlacing(false);
    }
  }

  return (
    <section aria-label={`${merchant.name} menu`}>
      <h2>{merchant.name}</h2>
      {loading && <p role="status">Loading…</p>}
      <ErrorBanner message={error} />
      {products?.length === 0 && <p className="muted">This restaurant has no items yet.</p>}
      <ul aria-label="Menu items">
        {products?.map((p) => (
          <li key={p.id}>
            <span>{p.name}{p.description ? <small className="muted"> — {p.description}</small> : null}</span>
            <span>{formatMoney(p.price_cents)} <button onClick={() => setCart((c) => addToCart(c, p))} aria-label={`Add ${p.name}`}>Add</button></span>
          </li>
        ))}
      </ul>
      <ReviewList merchantId={merchant.id} />
      <h3>Your order</h3>
      {lines.length === 0 && <p className="muted">Your cart is empty.</p>}
      <ul aria-label="Cart">
        {lines.map((l) => (
          <li key={l.product.id}>
            <span>{l.product.name}</span>
            <span>
              <button aria-label={`Decrease ${l.product.name}`} onClick={() => setCart((c) => setQuantity(c, l.product.id, l.quantity - 1))}>−</button>
              {' '}{l.quantity}{' '}
              <button aria-label={`Increase ${l.product.name}`} onClick={() => setCart((c) => setQuantity(c, l.product.id, l.quantity + 1))}>+</button>
            </span>
          </li>
        ))}
      </ul>
      {lines.length > 0 && <p>Items subtotal: <strong>{formatMoney(cartSubtotalCents(cart))}</strong> <small className="muted">(delivery fee and final total are set by the server)</small></p>}
      {lines.length > 0 && <PromoPreview subtotalCents={cartSubtotalCents(cart)} onChange={setPromoCode} />}
      <ErrorBanner message={orderError} />
      <button disabled={lines.length === 0 || placing} onClick={placeOrder}>{placing ? 'Placing…' : 'Place order'}</button>
    </section>
  );
}
