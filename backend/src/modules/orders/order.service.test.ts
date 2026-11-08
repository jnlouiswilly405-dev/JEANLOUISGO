import { describe, expect, it } from 'vitest';
import { assertValidOrderTransition, validateOrderInput } from './order.service.js';

describe('order lifecycle rules', () => {
  it('allows the defined payment and fulfillment transitions', () => {
    expect(() => assertValidOrderTransition('PENDING_PAYMENT', 'PAID')).not.toThrow();
    expect(() => assertValidOrderTransition('PAID', 'ACCEPTED')).not.toThrow();
    expect(() => assertValidOrderTransition('READY', 'ASSIGNED')).not.toThrow();
    expect(() => assertValidOrderTransition('ASSIGNED', 'PICKED_UP')).not.toThrow();
    expect(() => assertValidOrderTransition('IN_TRANSIT', 'DELIVERED')).not.toThrow();
  });

  it('rejects invalid transitions', () => {
    expect(() => assertValidOrderTransition('PENDING_PAYMENT', 'DELIVERED')).toThrow('Invalid transition');
    expect(() => assertValidOrderTransition('DELIVERED', 'CANCELLED')).toThrow('Invalid transition');
  });

  it('requires at least one item and positive integer quantities', () => {
    expect(() => validateOrderInput({ items: [] })).toThrow('at least one item');
    expect(() => validateOrderInput({ items: [{ productId: 'p1', name: 'Item', quantity: 0, unitPriceCents: 100 }] })).toThrow('positive integer');
    expect(() => validateOrderInput({ items: [{ productId: 'p1', name: 'Item', quantity: 1.5, unitPriceCents: 100 }] })).toThrow('positive integer');
  });

  it('rejects negative or fractional delivery fees', () => {
    const items = [{ productId: 'p1', name: 'Item', quantity: 1, unitPriceCents: 100 }];
    expect(() => validateOrderInput({ items, deliveryFeeCents: -1 })).toThrow('non-negative integer');
    expect(() => validateOrderInput({ items, deliveryFeeCents: 1.5 })).toThrow('non-negative integer');
  });

  it('accepts valid order input', () => {
    expect(() => validateOrderInput({ items: [{ productId: 'p1', name: 'Item', quantity: 2, unitPriceCents: 100 }], deliveryFeeCents: 500 })).not.toThrow();
  });
});
