import { describe, expect, it } from 'vitest';
import { getAuthProviderAvailability } from './auth-providers';

describe('getAuthProviderAvailability', () => {
  it('reports nothing available for an empty environment', () => {
    expect(getAuthProviderAvailability({})).toEqual({ github: false, google: false });
  });

  it('treats blank values as unset', () => {
    expect(
      getAuthProviderAvailability({ GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: ' ' }).google,
    ).toBe(false);
  });

  it('requires both the id and the secret', () => {
    expect(getAuthProviderAvailability({ GITHUB_CLIENT_ID: 'id' }).github).toBe(false);
    expect(
      getAuthProviderAvailability({ GITHUB_CLIENT_ID: 'id', GITHUB_CLIENT_SECRET: 's' }),
    ).toEqual({ github: true, google: false });
  });
});
