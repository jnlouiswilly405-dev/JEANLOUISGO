import { describe, expect, it } from 'vitest';
import { parsePriceToCents } from './price.js';

describe('parsePriceToCents', () => {
  it.each([['12', 1200], ['12.5', 1250], ['12.50', 1250], ['0.99', 99], [' 7 ', 700]])('%s -> %i', (input, cents) => {
    expect(parsePriceToCents(input)).toBe(cents);
  });
  it.each(['', 'abc', '-1', '1.234', '1,50', '1e3', '99999999'])('rejects %j', (input) => {
    expect(parsePriceToCents(input)).toBeNull();
  });
});
