import { describe, expect, it } from 'vitest';
import {
  finalizeUrlKey,
  isReservedUrlKey,
  RESERVED_URL_KEYS,
  sanitizeUrlKeyInput,
} from './url-key';

describe('sanitizeUrlKeyInput', () => {
  it('keeps a trailing hyphen so "acme-corp" can be typed', () => {
    expect(sanitizeUrlKeyInput('acme-')).toBe('acme-');
    expect(sanitizeUrlKeyInput('acme-c')).toBe('acme-c');
  });

  it('drops leading hyphens and collapses runs', () => {
    expect(sanitizeUrlKeyInput('--a  b')).toBe('a-b');
  });

  it('strips accents and illegal characters', () => {
    expect(sanitizeUrlKeyInput('Café_Ñ')).toBe('cafe-n');
  });
});

describe('finalizeUrlKey', () => {
  it('trims edge hyphens and caps at 63', () => {
    expect(finalizeUrlKey('acme-')).toBe('acme');
    expect(finalizeUrlKey('a'.repeat(100))).toHaveLength(63);
  });
});

describe('isReservedUrlKey', () => {
  it('flags route-colliding keys case-insensitively', () => {
    for (const key of ['admin', 'login', 'roadmap', 'Verify']) {
      expect(isReservedUrlKey(key)).toBe(true);
    }
    expect(isReservedUrlKey('acme')).toBe(false);
  });

  it('only lists keys the URL_KEY shape would otherwise accept', () => {
    for (const key of RESERVED_URL_KEYS) {
      expect(key).toMatch(/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/);
    }
  });
});
