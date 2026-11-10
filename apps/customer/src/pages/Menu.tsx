import { useState } from 'react';
import { ErrorBanner, ReviewList, useAsync, useLocalization, useSession } from '@multigo/app-shell';
import { formatMoney, type DeliveryAddress, type Merchant } from '@multigo/api-client';
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
  const [deliveryAddress, setDeliveryAddress] = useState<DeliveryAddress>({
    line1: '',
    city: '',
    stateCode: '',
    postalCode: '',
  });
  const [areaStatus, setAreaStatus] = useState<'idle' | 'checking' | 'available' | 'unavailable'>('idle');
  const [areaError, setAreaError] = useState<string | null>(null);
  const lines = Object.values(cart);
  const validAreaLookup = /^[A-Z]{2}$/.test(deliveryAddress.stateCode.trim())
    && /^[0-9]{5}$/.test(deliveryAddress.postalCode.trim());
  const completeAddress = deliveryAddress.line1.trim().length > 0
    && deliveryAddress.city.trim().length > 0
    && validAreaLookup;

  function updateAddress(field: keyof DeliveryAddress, value: string) {
    setDeliveryAddress((current) => ({
      ...current,
      [field]: field === 'stateCode' ? value.toUpperCase() : value,
    }));
    setAreaStatus('idle');
    setAreaError(null);
    setOrderError(null);
  }

  async function checkDeliveryArea() {
    if (!validAreaLookup) return;
    setAreaStatus('checking');
    setAreaError(null);
    try {
      const result = await client.serviceAreas.check(deliveryAddress.stateCode.trim(), deliveryAddress.postalCode.trim());
      setAreaStatus(result.eligible ? 'available' : 'unavailable');
    } catch (e) {
      setAreaStatus('idle');
      setAreaError(e instanceof Error ? e.message : t('serviceAreaCheckFailed'));
    }
  }

  async function placeOrder() {
    if (!completeAddress || areaStatus !== 'available') {
      setOrderError(t('deliveryAddressRequired'));
      return;
    }
    setPlacing(true);
    setOrderError(null);
    try {
      const order = await client.orders.create({
        merchantId: merchant.id,
        items: cartToOrderItems(cart),
        deliveryAddress: {
          line1: deliveryAddress.line1.trim(),
          ...(deliveryAddress.line2?.trim() ? { line2: deliveryAddress.line2.trim() } : {}),
          city: deliveryAddress.city.trim(),
          stateCode: deliveryAddress.stateCode.trim().toUpperCase(),
          postalCode: deliveryAddress.postalCode.trim(),
        },
        ...(promoCode ? { promoCode } : {}),
      });
      onOrdered(order.id);
    } catch (e) {
      const text = e instanceof Error ? e.message : '';
      if (text === 'DELIVERY_AREA_UNAVAILABLE') {
        setAreaStatus('unavailable');
      } else {
        setOrderError(
          text.includes('PROMO_ALREADY_USED') ? t('promoAlreadyUsedLong')
          : text.includes('PROMO_NOT_APPLICABLE') ? t('promoNotApplicable')
          : text.includes('PROMO_INVALID') ? t('promoInvalidLong')
          : text || t('couldNotPlaceOrder'),
        );
      }
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
      <section aria-label={t('deliveryAddress')}>
        <h3>{t('deliveryAddress')}</h3>
        <p className="muted">{t('deliveryAddressRequired')}</p>
        <label>{t('addressLine1')}<input required disabled={areaStatus === 'checking'} value={deliveryAddress.line1} onChange={(e) => updateAddress('line1', e.target.value)} maxLength={200} autoComplete="address-line1" /></label>
        <label>{t('addressLine2')}<input disabled={areaStatus === 'checking'} value={deliveryAddress.line2 ?? ''} onChange={(e) => updateAddress('line2', e.target.value)} maxLength={200} autoComplete="address-line2" /></label>
        <label>{t('city')}<input required disabled={areaStatus === 'checking'} value={deliveryAddress.city} onChange={(e) => updateAddress('city', e.target.value)} maxLength={100} autoComplete="address-level2" /></label>
        <label>{t('stateCode')}<input required disabled={areaStatus === 'checking'} value={deliveryAddress.stateCode} onChange={(e) => updateAddress('stateCode', e.target.value.slice(0, 2))} maxLength={2} autoComplete="address-level1" /></label>
        <label>{t('zipCode')}<input required disabled={areaStatus === 'checking'} value={deliveryAddress.postalCode} onChange={(e) => updateAddress('postalCode', e.target.value.replace(/\D/g, '').slice(0, 5))} maxLength={5} inputMode="numeric" autoComplete="postal-code" /></label>
        <button type="button" disabled={!validAreaLookup || areaStatus === 'checking'} onClick={checkDeliveryArea}>
          {areaStatus === 'checking' ? t('checkingDeliveryArea') : t('checkDeliveryArea')}
        </button>
        {areaStatus === 'available' && <p role="status">{t('deliveryAvailable')}</p>}
        {areaStatus === 'unavailable' && <p role="status">{t('comingSoon')}</p>}
        <ErrorBanner message={areaError} />
      </section>
      <ErrorBanner message={orderError} />
      <button disabled={lines.length === 0 || placing || !completeAddress || areaStatus !== 'available'} onClick={placeOrder}>
        {placing ? t('placingOrder') : t('placeOrder')}
      </button>
    </section>
  );
}
