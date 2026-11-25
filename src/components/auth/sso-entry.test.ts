import { describe, expect, it } from 'vitest';
import { ssoInitiateUrl } from './sso-entry';

describe('ssoInitiateUrl', () => {
  it('normalises the workspace key and carries the destination', () => {
    expect(ssoInitiateUrl('Acme-', '/acme/team/ENG?x=1')).toBe(
      '/api/auth/saml/initiate?org=acme&redirect=%2Facme%2Fteam%2FENG%3Fx%3D1',
    );
  });

  it('omits redirect when there is no destination', () => {
    expect(ssoInitiateUrl('acme', null)).toBe('/api/auth/saml/initiate?org=acme');
  });
});
