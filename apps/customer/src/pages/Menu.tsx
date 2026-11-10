import { useState } from 'react';
import { ErrorBanner, ReviewList, useAsync, useLocalization, useSession } from '@multigo/app-shell';
import { formatMoney, type Merchant } from '@multigo/api-client';
import { addToCart, cartSubtotalCents, cartToOrderItems, setQuantity, type Cart } from '../cart.js';
import { PromoPreview } from './PromoPreview.js';

export function Menu({ merchant, onOrdered }: { merchant: Merchant; onOrdered: (orderId: string) => void }) {
  const { client } = useSession();
  const { locale, t } = useLocalization();
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
        text.includes('PROMO_ALREADY_USED') ? t('promoAlreadyUsedLong')
        : text.includes('PROMO_NOT_APPLICABLE') ? t('promoNotApplicable')
        : text.includes('PROMO_INVALID') ? t('promoInvalidLong')
        : text || t('couldNotPlaceOrder'),
      );
    } finally {
      setPlacing(false);
    }
  }

  return (
    <section aria-label={`${merchant.name} — ${t('menu')}`}>
      <h2>{merchant.name}</h2>
      {loading && <p role="status">{t('loading')}</p>}
      <ErrorBanner message={error} />
      {products?.length === 0 && <p className="muted">{t('noRestaurantItems')}</p>}
      <ul aria-label={t('menuItems')}>
        {products?.map((p) => (
          <li key={p.id}>
            <span>{p.name}{p.description ? <small className="muted"> — {p.description}</small> : null}</span>
            <span>{formatMoney(p.price_cents, 'USD', locale)} <button onClick={() => setCart((c) => addToCart(c, p))} aria-label={t('addNamed', { name: p.name })}>{t('add')}</button></span>
          </li>
        ))}
      </ul>
      <ReviewList merchantId={merchant.id} />
      <h3>{t('yourOrder')}</h3>
      {lines.length === 0 && <p className="muted">{t('cartEmpty')}</p>}
      <ul aria-label={t('cart')}>
        {lines.map((l) => (
          <li key={l.product.id}>
            <span>{l.product.name}</span>
            <span>
              <button aria-label={t('decreaseNamed', { name: l.product.name })} onClick={() => setCart((c) => setQuantity(c, l.product.id, l.quantity - 1))}>−</button>
              {' '}{l.quantity}{' '}
              <button aria-label={t('increaseNamed', { name: l.product.name })} onClick={() => setCart((c) => setQuantity(c, l.product.id, l.quantity + 1))}>+</button>
            </span>
          </li>
        ))}
      </ul>
      {lines.length > 0 && <p>{t('itemsSubtotal')} <strong>{formatMoney(cartSubtotalCents(cart), 'USD', locale)}</strong> <small className="muted">{t('deliveryTotalByServer')}</small></p>}
      {lines.length > 0 && <PromoPreview subtotalCents={cartSubtotalCents(cart)} onChange={setPromoCode} />}
      <ErrorBanner message={orderError} />
      <button disabled={lines.length === 0 || placing} onClick={placeOrder}>{placing ? t('placingOrder') : t('placeOrder')}</button>
    </section>
  );
}
