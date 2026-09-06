import { describe, expect, it } from 'vitest';
import { createMockPrisma } from '../../test/prisma-mock';
import {
  getSyncVisibility,
  getSyncVisibilityBatch,
  isUnrestricted,
  type SyncVisibility,
} from './sync-visibility';

describe('getSyncVisibilityBatch', () => {
  it('derives hidden private teams and guest teams per (org, user) pair from two queries', async () => {
    const prisma = createMockPrisma();
    prisma.team.findMany.mockResolvedValue([
      { id: 't-secret', memberships: [{ userId: 'alice' }], organizationId: 'org-1' },
      { id: 't-other-org', memberships: [], organizationId: 'org-2' },
    ]);
    prisma.teamMemberRole.findMany.mockResolvedValue([
      { team: { organizationId: 'org-1' }, teamId: 't-guest', userId: 'bob' },
    ]);

    const scopes = await getSyncVisibilityBatch(prisma as never, [
      { orgId: 'org-1', userId: 'alice' },
      { orgId: 'org-1', userId: 'bob' },
    ]);
    const [alice, bob] = scopes as [SyncVisibility, SyncVisibility];

    expect(alice).toEqual({ guestTeamIds: [], hiddenTeamIds: [], userId: 'alice' });
    expect(bob).toEqual({ guestTeamIds: ['t-guest'], hiddenTeamIds: ['t-secret'], userId: 'bob' });
    expect(isUnrestricted(alice)).toBe(true);
    expect(isUnrestricted(bob)).toBe(false);
    expect(prisma.team.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.teamMemberRole.findMany).toHaveBeenCalledTimes(1);
    // Only private, live teams are consulted — public teams never hide anything.
    expect(prisma.team.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { archivedAt: null, organizationId: { in: ['org-1'] }, private: true },
      }),
    );
  });

  it('returns nothing for no pairs without touching the database', async () => {
    const prisma = createMockPrisma();
    expect(await getSyncVisibilityBatch(prisma as never, [])).toEqual([]);
    expect(prisma.team.findMany).not.toHaveBeenCalled();
  });

  it('getSyncVisibility is the single-pair form', async () => {
    const prisma = createMockPrisma();
    prisma.team.findMany.mockResolvedValue([
      { id: 't-secret', memberships: [], organizationId: 'org-1' },
    ]);
    prisma.teamMemberRole.findMany.mockResolvedValue([]);
    expect(await getSyncVisibility(prisma as never, 'carol', 'org-1')).toEqual({
      guestTeamIds: [],
      hiddenTeamIds: ['t-secret'],
      userId: 'carol',
    });
  });
});
