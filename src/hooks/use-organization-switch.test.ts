import { describe, expect, it } from 'vitest';
import { destinationFor } from './use-organization-switch';

describe('destinationFor', () => {
  it('rebases the current page onto the destination workspace', () => {
    // The point of preserving the path: switching workspaces from the
    // issues list should land on the issues list, not the workspace root.
    expect(destinationFor('beta', '/acme/team/ENG/issues')).toBe('/beta/team/ENG/issues');
    expect(destinationFor('beta', '/acme/my-issues')).toBe('/beta/my-issues');
  });

  it('falls back to the workspace root without a usable path', () => {
    expect(destinationFor('beta')).toBe('/beta');
    expect(destinationFor('beta', '/acme')).toBe('/beta');
    expect(destinationFor('beta', '/')).toBe('/beta');
  });

  it('refuses anything that is not a plain in-app absolute path', () => {
    // This value can originate from a URL the user merely followed, and it
    // goes straight into `location.assign` — a protocol-relative or absolute
    // URL surviving here would be an open redirect out of the app.
    expect(destinationFor('beta', '//evil.example.com/phish')).toBe('/beta');
    expect(destinationFor('beta', 'https://evil.example.com')).toBe('/beta');
    expect(destinationFor('beta', 'acme/team/ENG')).toBe('/beta');
    expect(destinationFor('beta', '')).toBe('/beta');
  });
});
