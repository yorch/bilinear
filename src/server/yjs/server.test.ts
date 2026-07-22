/**
 * Unit tests for the YJS collab server's re-auth predicate.
 *
 * `yjs/server.ts` only constructs the Hocuspocus `Server` configuration (no
 * `.listen()` call — that's `yjs/index.ts`'s job), so importing it here has
 * no side effects beyond scheduling the periodic sweep's `setInterval`
 * (unref'd, and never advanced in this file, so it never fires).
 *
 * `revalidateAccess` is the shared predicate behind both new re-validation
 * layers (the `onStoreDocument` gate and `sweepRevokedYjsConnections`) — it
 * takes an injected Prisma client, so it's fully testable with a mock and no
 * live socket/Hocuspocus runtime. The two call sites that plug live
 * Hocuspocus `Connection`/`Document` objects into it (closing a revoked
 * socket) are exercised only by code review + this predicate's own test
 * coverage; verifying an actual collab connection gets closed within one
 * sweep interval needs a staging pass with a real browser/Hocuspocus client.
 */

import { describe, expect, it } from 'vitest';
import { TEST_ISSUE, TEST_ORG, TEST_TEAM, TEST_TEAM_MEMBERSHIP, TEST_USER } from '@/test/fixtures';
import { createMockPrisma } from '@/test/prisma-mock';
import { revalidateAccess } from './server';

const ISSUE_DOC = { id: TEST_ISSUE.id, type: 'issue' as const };

describe('revalidateAccess', () => {
  it('is valid for an active user, a live org, and a team member on the issue', async () => {
    const prisma = createMockPrisma();
    prisma.user.findUnique.mockResolvedValue({ active: true });
    prisma.organization.findUnique.mockResolvedValue({ archivedAt: null, suspendedAt: null });
    prisma.issue.findFirst.mockResolvedValue({
      assigneeId: null,
      creatorId: TEST_USER.id,
      teamId: TEST_TEAM.id,
    });
    prisma.teamMembership.findUnique.mockResolvedValue(TEST_TEAM_MEMBERSHIP);
    prisma.teamMemberRole.findUnique.mockResolvedValue(null); // defaults to 'member'

    const result = await revalidateAccess(prisma as never, ISSUE_DOC, TEST_ORG.id, TEST_USER.id);

    expect(result).toEqual({ valid: true });
  });

  it('is invalid when the user has been deactivated', async () => {
    const prisma = createMockPrisma();
    prisma.user.findUnique.mockResolvedValue({ active: false });

    const result = await revalidateAccess(prisma as never, ISSUE_DOC, TEST_ORG.id, TEST_USER.id);

    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/deactivated/);
    // Short-circuits before any org/issue lookups.
    expect(prisma.organization.findUnique).not.toHaveBeenCalled();
  });

  it('is invalid when the user row no longer exists', async () => {
    const prisma = createMockPrisma();
    prisma.user.findUnique.mockResolvedValue(null);

    const result = await revalidateAccess(prisma as never, ISSUE_DOC, TEST_ORG.id, TEST_USER.id);

    expect(result.valid).toBe(false);
  });

  it('is invalid when the org is suspended', async () => {
    const prisma = createMockPrisma();
    prisma.user.findUnique.mockResolvedValue({ active: true });
    prisma.organization.findUnique.mockResolvedValue({
      archivedAt: null,
      suspendedAt: new Date('2026-07-01T00:00:00Z'),
    });

    const result = await revalidateAccess(prisma as never, ISSUE_DOC, TEST_ORG.id, TEST_USER.id);

    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/suspended/);
  });

  it('is invalid when the org is archived', async () => {
    const prisma = createMockPrisma();
    prisma.user.findUnique.mockResolvedValue({ active: true });
    prisma.organization.findUnique.mockResolvedValue({
      archivedAt: new Date('2026-07-01T00:00:00Z'),
      suspendedAt: null,
    });

    const result = await revalidateAccess(prisma as never, ISSUE_DOC, TEST_ORG.id, TEST_USER.id);

    expect(result.valid).toBe(false);
  });

  it('is invalid when the org row no longer exists', async () => {
    const prisma = createMockPrisma();
    prisma.user.findUnique.mockResolvedValue({ active: true });
    prisma.organization.findUnique.mockResolvedValue(null);

    const result = await revalidateAccess(prisma as never, ISSUE_DOC, TEST_ORG.id, TEST_USER.id);

    expect(result.valid).toBe(false);
  });

  it('is invalid when the issue is not found (archived or cross-org)', async () => {
    const prisma = createMockPrisma();
    prisma.user.findUnique.mockResolvedValue({ active: true });
    prisma.organization.findUnique.mockResolvedValue({ archivedAt: null, suspendedAt: null });
    prisma.issue.findFirst.mockResolvedValue(null);

    const result = await revalidateAccess(prisma as never, ISSUE_DOC, TEST_ORG.id, TEST_USER.id);

    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/not found/);
  });

  it('is invalid when the user is no longer a member of the issue team', async () => {
    const prisma = createMockPrisma();
    prisma.user.findUnique.mockResolvedValue({ active: true });
    prisma.organization.findUnique.mockResolvedValue({ archivedAt: null, suspendedAt: null });
    prisma.issue.findFirst.mockResolvedValue({
      assigneeId: null,
      creatorId: TEST_USER.id,
      teamId: TEST_TEAM.id,
    });
    prisma.teamMembership.findUnique.mockResolvedValue(null); // removed from team

    const result = await revalidateAccess(prisma as never, ISSUE_DOC, TEST_ORG.id, TEST_USER.id);

    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/team/);
  });

  it('is invalid when a guest is neither creator nor assignee of the issue', async () => {
    const prisma = createMockPrisma();
    prisma.user.findUnique.mockResolvedValue({ active: true });
    prisma.organization.findUnique.mockResolvedValue({ archivedAt: null, suspendedAt: null });
    prisma.issue.findFirst.mockResolvedValue({
      assigneeId: null,
      creatorId: 'some-other-user',
      teamId: TEST_TEAM.id,
    });
    prisma.teamMembership.findUnique.mockResolvedValue(TEST_TEAM_MEMBERSHIP);
    prisma.teamMemberRole.findUnique.mockResolvedValue({ role: 'guest' });

    const result = await revalidateAccess(prisma as never, ISSUE_DOC, TEST_ORG.id, TEST_USER.id);

    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/guest/);
  });

  it('is valid for a guest who created the issue', async () => {
    const prisma = createMockPrisma();
    prisma.user.findUnique.mockResolvedValue({ active: true });
    prisma.organization.findUnique.mockResolvedValue({ archivedAt: null, suspendedAt: null });
    prisma.issue.findFirst.mockResolvedValue({
      assigneeId: null,
      creatorId: TEST_USER.id,
      teamId: TEST_TEAM.id,
    });
    prisma.teamMembership.findUnique.mockResolvedValue(TEST_TEAM_MEMBERSHIP);
    prisma.teamMemberRole.findUnique.mockResolvedValue({ role: 'guest' });

    const result = await revalidateAccess(prisma as never, ISSUE_DOC, TEST_ORG.id, TEST_USER.id);

    expect(result).toEqual({ valid: true });
  });

  describe('document rooms', () => {
    const DOC_DOC = { id: '00000000-0000-0000-0000-000000000900', type: 'document' as const };

    it('is invalid when the document is not found', async () => {
      const prisma = createMockPrisma();
      prisma.user.findUnique.mockResolvedValue({ active: true });
      prisma.organization.findUnique.mockResolvedValue({ archivedAt: null, suspendedAt: null });
      prisma.document.findFirst.mockResolvedValue(null);

      const result = await revalidateAccess(prisma as never, DOC_DOC, TEST_ORG.id, TEST_USER.id);

      expect(result.valid).toBe(false);
    });

    it('is valid for a workspace-level document (null teamId) regardless of team membership', async () => {
      const prisma = createMockPrisma();
      prisma.user.findUnique.mockResolvedValue({ active: true });
      prisma.organization.findUnique.mockResolvedValue({ archivedAt: null, suspendedAt: null });
      prisma.document.findFirst.mockResolvedValue({ teamId: null });

      const result = await revalidateAccess(prisma as never, DOC_DOC, TEST_ORG.id, TEST_USER.id);

      expect(result).toEqual({ valid: true });
      expect(prisma.teamMembership.findUnique).not.toHaveBeenCalled();
    });

    it('is invalid when the document is team-scoped and the user is no longer a member', async () => {
      const prisma = createMockPrisma();
      prisma.user.findUnique.mockResolvedValue({ active: true });
      prisma.organization.findUnique.mockResolvedValue({ archivedAt: null, suspendedAt: null });
      prisma.document.findFirst.mockResolvedValue({ teamId: TEST_TEAM.id });
      prisma.teamMembership.findUnique.mockResolvedValue(null);

      const result = await revalidateAccess(prisma as never, DOC_DOC, TEST_ORG.id, TEST_USER.id);

      expect(result.valid).toBe(false);
    });

    it('is valid when the document is team-scoped and the user is still a member', async () => {
      const prisma = createMockPrisma();
      prisma.user.findUnique.mockResolvedValue({ active: true });
      prisma.organization.findUnique.mockResolvedValue({ archivedAt: null, suspendedAt: null });
      prisma.document.findFirst.mockResolvedValue({ teamId: TEST_TEAM.id });
      prisma.teamMembership.findUnique.mockResolvedValue(TEST_TEAM_MEMBERSHIP);
      prisma.teamMemberRole.findUnique.mockResolvedValue(null);

      const result = await revalidateAccess(prisma as never, DOC_DOC, TEST_ORG.id, TEST_USER.id);

      expect(result).toEqual({ valid: true });
    });
  });
});
