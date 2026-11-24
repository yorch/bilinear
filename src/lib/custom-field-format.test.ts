import { describe, expect, it } from 'vitest';
import {
  formatNumberValue,
  isValidCurrencyCode,
  type NumberFieldFormat,
  parseNumberFormat,
} from './custom-field-format';

const f = (format: NumberFieldFormat, v: number | null | undefined, locale = 'en-US') =>
  formatNumberValue(v, format, locale);

describe('formatNumberValue', () => {
  it('formats plain with grouping and keeps decimals', () => {
    expect(f({ kind: 'plain' }, 1234567.891)).toBe('1,234,567.891');
    expect(f({ kind: 'plain', decimals: 1 }, 2.25)).toBe('2.3');
  });

  it('formats currency, locale-aware, negative', () => {
    expect(f({ currency: 'USD', kind: 'currency' }, 1234.5)).toBe('$1,234.50');
    expect(f({ currency: 'USD', kind: 'currency' }, -5)).toBe('-$5.00');
    expect(f({ currency: 'eur', kind: 'currency' }, 1234.5, 'de-DE')).toMatch(/^1\.234,50\s€$/);
  });

  it('degrades an invalid currency code instead of throwing', () => {
    expect(f({ currency: 'US', kind: 'currency' }, 12.5)).toBe('12.5 US');
    expect(f({ currency: '', kind: 'currency' }, 12.5)).toBe('12.5');
    expect(isValidCurrencyCode('USD')).toBe(true);
    expect(isValidCurrencyCode('$$$')).toBe(false);
  });

  it('formats percent as typed, not scaled', () => {
    expect(f({ kind: 'percent' }, 45)).toBe('45%');
    expect(f({ kind: 'percent', decimals: 0 }, 12.6)).toBe('13%');
    expect(f({ kind: 'percent' }, -3.5)).toBe('-3.5%');
  });

  it('formats duration from minutes', () => {
    expect(f({ kind: 'duration' }, 90)).toBe('1h 30m');
    expect(f({ kind: 'duration' }, 1500)).toBe('1d 1h');
    expect(f({ kind: 'duration' }, 0)).toBe('0m');
    expect(f({ kind: 'duration' }, -90)).toBe('-1h 30m');
  });

  it('formats compact, including huge values', () => {
    expect(f({ kind: 'compact' }, 1234)).toBe('1.2K');
    expect(f({ kind: 'compact' }, 1_500_000_000)).toBe('1.5B');
    expect(f({ kind: 'compact' }, -1234)).toBe('-1.2K');
    expect(f({ kind: 'plain' }, 1e21)).toBe('1,000,000,000,000,000,000,000');
  });

  it('renders null, undefined and NaN as empty and infinity as a symbol', () => {
    expect(f({ kind: 'currency', currency: 'USD' }, null)).toBe('');
    expect(f({ kind: 'plain' }, undefined)).toBe('');
    expect(f({ kind: 'plain' }, Number.NaN)).toBe('');
    expect(f({ kind: 'plain' }, Number.POSITIVE_INFINITY)).toBe('∞');
  });

  it('clamps absurd decimals', () => {
    expect(f({ decimals: 99, kind: 'plain' }, 1.5)).toBe('1.5');
  });
});

describe('parseNumberFormat', () => {
  it('falls back to plain on junk', () => {
    expect(parseNumberFormat(null)).toEqual({ kind: 'plain' });
    expect(parseNumberFormat({ kind: 'bogus' })).toEqual({ kind: 'plain' });
    expect(parseNumberFormat({ currency: 'EUR', kind: 'currency' })).toEqual({
      currency: 'EUR',
      kind: 'currency',
    });
  });
});
