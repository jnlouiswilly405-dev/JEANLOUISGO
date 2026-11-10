import { describe, expect, it } from 'vitest';
import { formatMoney } from './format.js';

describe('formatMoney', () => {
  it('keeps the existing default locale and supports localized currency formatting', () => {
    expect(formatMoney(1234)).toBe('$12.34');
    expect(formatMoney(1234, 'USD', 'fr-FR')).toContain(',34');
  });
});
