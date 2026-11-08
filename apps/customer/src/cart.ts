import type { Product } from '@multigo/api-client';

export interface CartLine { product: Product; quantity: number }
export type Cart = Record<string, CartLine>;

export function addToCart(cart: Cart, product: Product): Cart {
  const line = cart[product.id];
  return { ...cart, [product.id]: { product, quantity: (line?.quantity ?? 0) + 1 } };
}

export function setQuantity(cart: Cart, productId: string, quantity: number): Cart {
  if (quantity <= 0) { const { [productId]: _removed, ...rest } = cart; return rest; }
  const line = cart[productId];
  return line ? { ...cart, [productId]: { ...line, quantity } } : cart;
}

/** Display-only estimate; the server recomputes prices from the catalog when the order is created. */
export function cartSubtotalCents(cart: Cart): number {
  return Object.values(cart).reduce((sum, l) => sum + l.product.price_cents * l.quantity, 0);
}

export function cartToOrderItems(cart: Cart) {
  return Object.values(cart).map((l) => ({ productId: l.product.id, quantity: l.quantity }));
}
