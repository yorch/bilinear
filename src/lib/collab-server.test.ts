import { afterEach, describe, expect, it } from 'vitest';
import { getServerCollabConfig } from './collab-server';

const ORIGINAL = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL };
});

describe('getServerCollabConfig', () => {
  it('is disabled and unconfigured by default', () => {
    // `delete`, not `= undefined` — the latter stores the STRING "undefined".
    delete process.env.COLLAB_ENABLED;
    delete process.env.YJS_PUBLIC_URL;
    expect(getServerCollabConfig()).toEqual({ enabled: false, serverUrl: null });
  });

  it('accepts the documented "true" spelling', () => {
    process.env.COLLAB_ENABLED = 'true';
    expect(getServerCollabConfig().enabled).toBe(true);
  });

  it('also accepts "1", the convention every other boolean flag uses', () => {
    process.env.COLLAB_ENABLED = '1';
    expect(getServerCollabConfig().enabled).toBe(true);
  });

  it('is case- and whitespace-insensitive', () => {
    process.env.COLLAB_ENABLED = '  TRUE  ';
    expect(getServerCollabConfig().enabled).toBe(true);
  });

  it('treats anything else as off rather than truthy', () => {
    for (const value of ['false', '0', 'yes', '', 'off']) {
      process.env.COLLAB_ENABLED = value;
      expect(getServerCollabConfig().enabled).toBe(false);
    }
  });

  it('passes the YJS URL through untouched — the client resolves it', () => {
    process.env.YJS_PUBLIC_URL = '/collab';
    expect(getServerCollabConfig().serverUrl).toBe('/collab');
  });

  it('normalizes a whitespace-only URL to null so the client can fall back', () => {
    process.env.YJS_PUBLIC_URL = '   ';
    expect(getServerCollabConfig().serverUrl).toBeNull();
  });
});
