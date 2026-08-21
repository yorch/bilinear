import { describe, expect, it } from 'vitest';
import { __testing } from './email';

/**
 * `branding.appName` used to be a build-time constant and is now a
 * database-backed knob, so it crosses a trust boundary it did not before. These
 * cover the two places it lands in something that parses structure rather than
 * text: the `From` header and the email body's HTML.
 */
describe('fromDisplayName', () => {
  it('strips characters that would end the quoted phrase', () => {
    // Left raw this address-parses into a second, attacker-chosen mailbox.
    const injected = 'Acme" <mail@elsewhere.test>, "x';
    const cleaned = __testing.fromDisplayName(injected);
    expect(cleaned).not.toContain('"');
    expect(cleaned).toBe('Acme <mail@elsewhere.test>, x');
  });

  it('strips CR and LF, which would splice headers', () => {
    expect(__testing.fromDisplayName('Acme\r\nBcc: victim@example.com')).toBe(
      'AcmeBcc: victim@example.com',
    );
  });

  it('caps the length and falls back when nothing survives', () => {
    expect(__testing.fromDisplayName('x'.repeat(500))).toHaveLength(64);
    expect(__testing.fromDisplayName('""')).toBe('Bilinear');
    expect(__testing.fromDisplayName('   ')).toBe('Bilinear');
  });
});
