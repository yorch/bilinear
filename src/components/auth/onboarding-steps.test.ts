import { describe, expect, it } from 'vitest';
import {
  deriveTeamKey,
  onboardingResumeUrl,
  parseInviteEmails,
  parseResumeStep,
  sanitizeTeamKey,
} from './onboarding-steps';

describe('deriveTeamKey', () => {
  it('uses initials for multi-word names and a prefix for one word', () => {
    expect(deriveTeamKey('Acme Robotics')).toBe('AR');
    expect(deriveTeamKey('Acme')).toBe('ACM');
  });
  it('strips accents and non-letters; empty when nothing usable', () => {
    expect(deriveTeamKey('Ünïcode 42')).toBe('UNI');
    expect(deriveTeamKey('1234')).toBe('');
  });
});

describe('sanitizeTeamKey', () => {
  it('uppercases, drops non-letters and caps at 10', () => {
    expect(sanitizeTeamKey('en-g1neering-team')).toBe('ENGNEERING');
    expect(sanitizeTeamKey('abcdefghijklm')).toHaveLength(10);
  });
});

describe('parseInviteEmails', () => {
  it('splits, dedupes case-insensitively and reports invalid entries', () => {
    expect(parseInviteEmails('a@x.io, B@x.io; a@X.io  nope\nc@y.co')).toEqual({
      invalid: ['nope'],
      valid: ['a@x.io', 'B@x.io', 'c@y.co'],
    });
  });
});

describe('resume step', () => {
  it('only team and invite are resumable', () => {
    expect(parseResumeStep('team')).toBe('team');
    expect(parseResumeStep(['invite', 'x'])).toBe('invite');
    expect(parseResumeStep('workspace')).toBeNull();
    expect(parseResumeStep(undefined)).toBeNull();
  });
  it('builds an encoded resume URL', () => {
    expect(onboardingResumeUrl('team', 'a&b')).toBe('/onboarding?org=a%26b&step=team');
  });
});
