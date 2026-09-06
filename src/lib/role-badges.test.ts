import { describe, expect, it } from 'vitest';
import { roleTone } from './role-badges';

describe('roleTone', () => {
  it('maps owner to brand and admin to info', () => {
    expect(roleTone('owner')).toBe('brand');
    expect(roleTone('admin')).toBe('info');
  });

  it('maps member and guest to muted', () => {
    expect(roleTone('member')).toBe('muted');
    expect(roleTone('guest')).toBe('muted');
  });

  it('falls back to muted for an unknown or missing role', () => {
    expect(roleTone('superuser')).toBe('muted');
    expect(roleTone(null)).toBe('muted');
    expect(roleTone(undefined)).toBe('muted');
  });
});
