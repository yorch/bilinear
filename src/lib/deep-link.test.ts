import { describe, expect, it } from 'vitest';
import { loginRedirectPath } from './deep-link';

describe('loginRedirectPath', () => {
  it('keeps the full deep path, search included', () => {
    expect(loginRedirectPath('/acme/team/ENG/issue/ENG-1?tab=a', '/acme')).toBe(
      `/login?next=${encodeURIComponent('/acme/team/ENG/issue/ENG-1?tab=a')}`,
    );
  });

  it('falls back to the supplied path when the header is absent', () => {
    expect(loginRedirectPath(null, '/acme')).toBe('/login?next=%2Facme');
  });

  it.each(['//evil.example', 'https://evil.example', '/a\\b'])(
    'never forwards an unsafe path: %s',
    bad => {
      expect(loginRedirectPath(bad, '/admin')).toBe('/login?next=%2Fadmin');
    },
  );
});
