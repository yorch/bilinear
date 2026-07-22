import { describe, expect, it } from 'vitest';
import { createMockPrisma } from '../../test/prisma-mock';
import { createLoaders } from './loaders';

describe('createLoaders', () => {
  describe('reactionsByIssueId', () => {
    it('batches N .load() calls into a single findMany and groups by issueId', async () => {
      const prisma = createMockPrisma();
      prisma.issueReaction.findMany.mockResolvedValue([
        { emoji: '👍', issueId: 'issue-1', user: { id: 'u1' } },
        { emoji: '🎉', issueId: 'issue-2', user: { id: 'u2' } },
        { emoji: '👀', issueId: 'issue-1', user: { id: 'u3' } },
      ]);
      const loaders = createLoaders(prisma as never, 'org-1');

      const [r1, r2, r3] = await Promise.all([
        loaders.reactionsByIssueId.load('issue-1'),
        loaders.reactionsByIssueId.load('issue-2'),
        loaders.reactionsByIssueId.load('issue-3'),
      ]);

      expect(prisma.issueReaction.findMany).toHaveBeenCalledTimes(1);
      expect(r1.map(r => r.emoji)).toEqual(['👍', '👀']);
      expect(r2.map(r => r.emoji)).toEqual(['🎉']);
      expect(r3).toEqual([]);
    });
  });

  describe('issueById', () => {
    it('batches into one findMany and preserves null for missing ids', async () => {
      const prisma = createMockPrisma();
      prisma.issue.findMany.mockResolvedValue([
        { id: 'issue-1', organizationId: 'org-1' },
        { id: 'issue-2', organizationId: 'org-1' },
      ]);
      const loaders = createLoaders(prisma as never, 'org-1');

      const [a, b, c] = await Promise.all([
        loaders.issueById.load('issue-1'),
        loaders.issueById.load('issue-2'),
        loaders.issueById.load('missing'),
      ]);

      expect(prisma.issue.findMany).toHaveBeenCalledTimes(1);
      expect(a).toEqual({ id: 'issue-1', organizationId: 'org-1' });
      expect(b).toEqual({ id: 'issue-2', organizationId: 'org-1' });
      expect(c).toBeNull();
    });
  });

  describe('childrenByParentId', () => {
    it('groups the batched sub-issue fetch by parentId', async () => {
      const prisma = createMockPrisma();
      prisma.issue.findMany.mockResolvedValue([
        { id: 'child-1', parentId: 'parent-1' },
        { id: 'child-2', parentId: 'parent-2' },
        { id: 'child-3', parentId: 'parent-1' },
      ]);
      const loaders = createLoaders(prisma as never, 'org-1');

      const [children1, children2] = await Promise.all([
        loaders.childrenByParentId.load('parent-1'),
        loaders.childrenByParentId.load('parent-2'),
      ]);

      expect(prisma.issue.findMany).toHaveBeenCalledTimes(1);
      expect(children1.map(c => c.id)).toEqual(['child-1', 'child-3']);
      expect(children2.map(c => c.id)).toEqual(['child-2']);
    });

    it('returns empty arrays without querying when orgId is null', async () => {
      const prisma = createMockPrisma();
      const loaders = createLoaders(prisma as never, null);

      const result = await loaders.childrenByParentId.load('parent-1');

      expect(result).toEqual([]);
      expect(prisma.issue.findMany).not.toHaveBeenCalled();
    });
  });

  describe('updatesByInitiativeId', () => {
    it('batches and groups initiative updates by initiativeId', async () => {
      const prisma = createMockPrisma();
      prisma.initiativeUpdate.findMany.mockResolvedValue([
        { createdAt: new Date('2026-01-02'), health: 'onTrack', initiativeId: 'init-1' },
        { createdAt: new Date('2026-01-01'), health: 'atRisk', initiativeId: 'init-2' },
      ]);
      const loaders = createLoaders(prisma as never, 'org-1');

      const [updates1, updates2] = await Promise.all([
        loaders.updatesByInitiativeId.load('init-1'),
        loaders.updatesByInitiativeId.load('init-2'),
      ]);

      expect(prisma.initiativeUpdate.findMany).toHaveBeenCalledTimes(1);
      expect(updates1).toHaveLength(1);
      expect(updates2).toHaveLength(1);
    });
  });

  describe('roleByTeamUser', () => {
    it('batches (teamId, userId) pairs into one findMany, matching exact pairs only', async () => {
      const prisma = createMockPrisma();
      prisma.teamMemberRole.findMany.mockResolvedValue([
        { role: 'admin', teamId: 'team-1', userId: 'user-1' },
        { role: 'guest', teamId: 'team-2', userId: 'user-2' },
      ]);
      const loaders = createLoaders(prisma as never, 'org-1');

      const [role1, role2, roleMissing] = await Promise.all([
        loaders.roleByTeamUser.load('team-1::user-1'),
        loaders.roleByTeamUser.load('team-2::user-2'),
        // Same ids, different pairing — must NOT cross-match team-1/user-2.
        loaders.roleByTeamUser.load('team-1::user-2'),
      ]);

      expect(prisma.teamMemberRole.findMany).toHaveBeenCalledTimes(1);
      expect(role1).toBe('admin');
      expect(role2).toBe('guest');
      // No row exists for team-1/user-2 — defaults to 'member', same as the
      // original per-row `tmr?.role ?? 'member'` fallback.
      expect(roleMissing).toBe('member');
    });
  });
});
