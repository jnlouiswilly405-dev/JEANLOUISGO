import { describe, expect, it } from 'vitest';
import { nextDriverAction } from './actions.js';

describe('nextDriverAction', () => {
  it('maps each active status to the backend endpoint that accepts it', () => {
    expect(nextDriverAction('ASSIGNED')).toMatchObject({ kind: 'status', status: 'PICKED_UP' });
    expect(nextDriverAction('PICKED_UP')).toMatchObject({ kind: 'delivery', action: 'PICKED_UP' });
    expect(nextDriverAction('IN_TRANSIT')).toMatchObject({ kind: 'delivery', action: 'DELIVERED' });
  });

  it.each(['PENDING_PAYMENT', 'PAID', 'ACCEPTED', 'PREPARING', 'READY', 'DELIVERED', 'CANCELLED', 'REFUNDED'] as const)('offers nothing for %s', (s) => {
    expect(nextDriverAction(s)).toBeNull();
  });
});
