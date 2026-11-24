import { describe, expect, it } from 'vitest';
import { pickLandingTeamKey } from './landing-team';

const teams = [
  { isMember: false, key: 'SEC', private: true },
  { isMember: false, key: 'ENG', private: false },
  { isMember: true, key: 'OPS', private: true },
];

describe('pickLandingTeamKey', () => {
  it('skips an older private team the viewer is not in', () => {
    expect(pickLandingTeamKey(teams, false)).toBe('ENG');
  });

  it('lets org admins land on the oldest team even when private', () => {
    expect(pickLandingTeamKey(teams, true)).toBe('SEC');
  });

  it('accepts a private team the viewer belongs to', () => {
    expect(pickLandingTeamKey([teams[0], teams[2]], false)).toBe('OPS');
  });

  it('returns null when nothing is accessible', () => {
    expect(pickLandingTeamKey([teams[0]], false)).toBeNull();
    expect(pickLandingTeamKey([], true)).toBeNull();
  });
});
