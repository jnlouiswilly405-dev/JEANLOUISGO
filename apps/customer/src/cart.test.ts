import { describe, expect, it } from 'vitest';
import type { Product } from '@multigo/api-client';
import { addToCart, cartSubtotalCents, cartToOrderItems, setQuantity } from './cart.js';

const p = (id: string, price: number): Product => ({ id, merchant_id: 'm', name: id, description: null, price_cents: price, active: true });

describe('cart', () => {
  it('adds, increments, and totals', () => {
    let c = addToCart({}, p('a', 500));
    c = addToCart(c, p('a', 500));
    c = addToCart(c, p('b', 125));
    expect(c.a.quantity).toBe(2);
    expect(cartSubtotalCents(c)).toBe(1125);
    expect(cartToOrderItems(c)).toEqual([{ productId: 'a', quantity: 2 }, { productId: 'b', quantity: 1 }]);
  });

  it('removes a line at quantity zero and ignores unknown ids', () => {
    let c = addToCart({}, p('a', 500));
    expect(setQuantity(c, 'zzz', 3)).toBe(c);
    c = setQuantity(c, 'a', 0);
    expect(c).toEqual({});
  });
});
