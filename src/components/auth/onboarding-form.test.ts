import { describe, expect, it } from 'vitest';
import { slugify } from './onboarding-form';

describe('slugify', () => {
  it('keeps the base letters of accented characters instead of dropping them', () => {
    expect(slugify('Acme Ünïcode & Co!')).toBe('acme-unicode-co');
    expect(slugify('Café Ñandú')).toBe('cafe-nandu');
  });

  it('collapses punctuation and trims separators', () => {
    expect(slugify('  --Hello,   World--  ')).toBe('hello-world');
  });

  it('caps the key at 63 characters', () => {
    expect(slugify('a'.repeat(100))).toHaveLength(63);
  });
});
