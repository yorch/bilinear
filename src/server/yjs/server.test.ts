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
import {
  TEST_ISSUE,
  TEST_ORG,
  TEST_TEAM,
  TEST_TEAM_MEMBERSHIP,
  TEST_USER,
  TEST_USER_2,
} from '@/test/fixtures';
import { createMockPrisma } from '@/test/prisma-mock';
import { revalidateAccess, revalidateRoomAccess } from './server';

const ISSUE_DOC = { id: TEST_ISSUE.id, type: 'issue' as const };

/**
 * `createMockPrisma()` plus a default "everyone in the room still belongs to
 * the org" stub. The org-membership arm of `checkSessionValidity` is new and
 * orthogonal to what most of these cases exercise (team roles, guest rules,
 * missing entities), so it is satisfied by default here and overridden only
 * by the tests that are specifically about losing membership.
 */
function mockPrisma() {
  const prisma = createMockPrisma();
  prisma.organizationMember.findUnique.mockResolvedValue({ role: 'member' });
  prisma.organizationMember.findMany.mockResolvedValue([
    { role: 'member', userId: TEST_USER.id },
    { role: 'member', userId: TEST_USER_2.id },
  ]);
  return prisma;
}

describe('revalidateAccess', () => {
  it('is valid for an active user, a live org, and a team member on the issue', async () => {
    const prisma = mockPrisma();
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
    const prisma = mockPrisma();
    prisma.user.findUnique.mockResolvedValue({ active: false });

    const result = await revalidateAccess(prisma as never, ISSUE_DOC, TEST_ORG.id, TEST_USER.id);

    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/deactivated/);
    // Short-circuits before any org/issue lookups.
    expect(prisma.organization.findUnique).not.toHaveBeenCalled();
  });

  it('is invalid when the user row no longer exists', async () => {
    const prisma = mockPrisma();
    prisma.user.findUnique.mockResolvedValue(null);

    const result = await revalidateAccess(prisma as never, ISSUE_DOC, TEST_ORG.id, TEST_USER.id);

    expect(result.valid).toBe(false);
  });

  it('is invalid when the org is suspended', async () => {
    const prisma = mockPrisma();
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
    const prisma = mockPrisma();
    prisma.user.findUnique.mockResolvedValue({ active: true });
    prisma.organization.findUnique.mockResolvedValue({
      archivedAt: new Date('2026-07-01T00:00:00Z'),
      suspendedAt: null,
    });

    const result = await revalidateAccess(prisma as never, ISSUE_DOC, TEST_ORG.id, TEST_USER.id);

    expect(result.valid).toBe(false);
  });

  it('is invalid when the org row no longer exists', async () => {
    const prisma = mockPrisma();
    prisma.user.findUnique.mockResolvedValue({ active: true });
    prisma.organization.findUnique.mockResolvedValue(null);

    const result = await revalidateAccess(prisma as never, ISSUE_DOC, TEST_ORG.id, TEST_USER.id);

    expect(result.valid).toBe(false);
  });

  it('is invalid when the user has been removed from the org', async () => {
    // The multi-org case: user active, org live, but the membership behind
    // the ws_ticket's `orgId` claim is gone. The collab room has to close
    // on that, not just on suspension.
    const prisma = mockPrisma();
    prisma.user.findUnique.mockResolvedValue({ active: true });
    prisma.organization.findUnique.mockResolvedValue({ archivedAt: null, suspendedAt: null });
    prisma.organizationMember.findUnique.mockResolvedValue(null);

    const result = await revalidateAccess(prisma as never, ISSUE_DOC, TEST_ORG.id, TEST_USER.id);

    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/member/);
    // Short-circuits before touching the issue itself.
    expect(prisma.issue.findFirst).not.toHaveBeenCalled();
  });

  it('is invalid when the issue is not found (archived or cross-org)', async () => {
    const prisma = mockPrisma();
    prisma.user.findUnique.mockResolvedValue({ active: true });
    prisma.organization.findUnique.mockResolvedValue({ archivedAt: null, suspendedAt: null });
    prisma.issue.findFirst.mockResolvedValue(null);

    const result = await revalidateAccess(prisma as never, ISSUE_DOC, TEST_ORG.id, TEST_USER.id);

    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/not found/);
  });

  it('is invalid when the user is no longer a member of the issue team', async () => {
    const prisma = mockPrisma();
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
    const prisma = mockPrisma();
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
    const prisma = mockPrisma();
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
      const prisma = mockPrisma();
      prisma.user.findUnique.mockResolvedValue({ active: true });
      prisma.organization.findUnique.mockResolvedValue({ archivedAt: null, suspendedAt: null });
      prisma.document.findFirst.mockResolvedValue(null);

      const result = await revalidateAccess(prisma as never, DOC_DOC, TEST_ORG.id, TEST_USER.id);

      expect(result.valid).toBe(false);
    });

    it('is valid for a workspace-level document (null teamId) regardless of team membership', async () => {
      const prisma = mockPrisma();
      prisma.user.findUnique.mockResolvedValue({ active: true });
      prisma.organization.findUnique.mockResolvedValue({ archivedAt: null, suspendedAt: null });
      prisma.document.findFirst.mockResolvedValue({ teamId: null });

      const result = await revalidateAccess(prisma as never, DOC_DOC, TEST_ORG.id, TEST_USER.id);

      expect(result).toEqual({ valid: true });
      expect(prisma.teamMembership.findUnique).not.toHaveBeenCalled();
    });

    it('is invalid when the document is team-scoped and the user is no longer a member', async () => {
      const prisma = mockPrisma();
      prisma.user.findUnique.mockResolvedValue({ active: true });
      prisma.organization.findUnique.mockResolvedValue({ archivedAt: null, suspendedAt: null });
      prisma.document.findFirst.mockResolvedValue({ teamId: TEST_TEAM.id });
      prisma.teamMembership.findUnique.mockResolvedValue(null);

      const result = await revalidateAccess(prisma as never, DOC_DOC, TEST_ORG.id, TEST_USER.id);

      expect(result.valid).toBe(false);
    });

    it('is valid when the document is team-scoped and the user is still a member', async () => {
      const prisma = mockPrisma();
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

describe('revalidateRoomAccess', () => {
  const OTHER_USER_ID = TEST_USER_2.id;

  it('returns an empty map for an empty user list without querying anything', async () => {
    const prisma = mockPrisma();

    const results = await revalidateRoomAccess(prisma as never, ISSUE_DOC, TEST_ORG.id, []);

    expect(results.size).toBe(0);
    expect(prisma.user.findMany).not.toHaveBeenCalled();
    expect(prisma.organization.findUnique).not.toHaveBeenCalled();
    expect(prisma.issue.findFirst).not.toHaveBeenCalled();
  });

  it('fetches the org and issue row exactly once for a room with multiple users', async () => {
    const prisma = mockPrisma();
    prisma.user.findMany.mockResolvedValue([
      { active: true, id: TEST_USER.id },
      { active: true, id: OTHER_USER_ID },
    ]);
    prisma.organization.findUnique.mockResolvedValue({ archivedAt: null, suspendedAt: null });
    prisma.issue.findFirst.mockResolvedValue({
      assigneeId: null,
      creatorId: TEST_USER.id,
      teamId: TEST_TEAM.id,
    });
    prisma.teamMembership.findUnique.mockResolvedValue(TEST_TEAM_MEMBERSHIP);
    prisma.teamMemberRole.findUnique.mockResolvedValue(null);

    const results = await revalidateRoomAccess(prisma as never, ISSUE_DOC, TEST_ORG.id, [
      TEST_USER.id,
      OTHER_USER_ID,
    ]);

    expect(results.get(TEST_USER.id)).toEqual({ valid: true });
    expect(results.get(OTHER_USER_ID)).toEqual({ valid: true });
    expect(prisma.user.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.organization.findUnique).toHaveBeenCalledTimes(1);
    expect(prisma.issue.findFirst).toHaveBeenCalledTimes(1);
  });

  it('de-dupes repeated user ids into a single query and result entry', async () => {
    const prisma = mockPrisma();
    prisma.user.findMany.mockResolvedValue([{ active: true, id: TEST_USER.id }]);
    prisma.organization.findUnique.mockResolvedValue({ archivedAt: null, suspendedAt: null });
    prisma.issue.findFirst.mockResolvedValue({
      assigneeId: null,
      creatorId: TEST_USER.id,
      teamId: TEST_TEAM.id,
    });
    prisma.teamMembership.findUnique.mockResolvedValue(TEST_TEAM_MEMBERSHIP);
    prisma.teamMemberRole.findUnique.mockResolvedValue(null);

    const results = await revalidateRoomAccess(prisma as never, ISSUE_DOC, TEST_ORG.id, [
      TEST_USER.id,
      TEST_USER.id,
    ]);

    expect(results.size).toBe(1);
    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: [TEST_USER.id] } } }),
    );
  });

  it('invalidates only the deactivated user, leaving other room connections valid', async () => {
    const prisma = mockPrisma();
    prisma.user.findMany.mockResolvedValue([
      { active: false, id: TEST_USER.id },
      { active: true, id: OTHER_USER_ID },
    ]);
    prisma.organization.findUnique.mockResolvedValue({ archivedAt: null, suspendedAt: null });
    prisma.issue.findFirst.mockResolvedValue({
      assigneeId: null,
      creatorId: OTHER_USER_ID,
      teamId: TEST_TEAM.id,
    });
    prisma.teamMembership.findUnique.mockResolvedValue(TEST_TEAM_MEMBERSHIP);
    prisma.teamMemberRole.findUnique.mockResolvedValue(null);

    const results = await revalidateRoomAccess(prisma as never, ISSUE_DOC, TEST_ORG.id, [
      TEST_USER.id,
      OTHER_USER_ID,
    ]);

    expect(results.get(TEST_USER.id)).toEqual({ reason: 'user deactivated', valid: false });
    expect(results.get(OTHER_USER_ID)).toEqual({ valid: true });
  });

  it('invalidates every user in the room when the org is suspended', async () => {
    const prisma = mockPrisma();
    prisma.user.findMany.mockResolvedValue([
      { active: true, id: TEST_USER.id },
      { active: true, id: OTHER_USER_ID },
    ]);
    prisma.organization.findUnique.mockResolvedValue({
      archivedAt: null,
      suspendedAt: new Date('2026-07-01T00:00:00Z'),
    });

    const results = await revalidateRoomAccess(prisma as never, ISSUE_DOC, TEST_ORG.id, [
      TEST_USER.id,
      OTHER_USER_ID,
    ]);

    expect(results.get(TEST_USER.id)?.valid).toBe(false);
    expect(results.get(OTHER_USER_ID)?.valid).toBe(false);
    // Org invalidity short-circuits before the per-user team/guest check.
    expect(prisma.teamMembership.findUnique).not.toHaveBeenCalled();
  });

  it('invalidates every user in the room when the issue is not found', async () => {
    const prisma = mockPrisma();
    prisma.user.findMany.mockResolvedValue([{ active: true, id: TEST_USER.id }]);
    prisma.organization.findUnique.mockResolvedValue({ archivedAt: null, suspendedAt: null });
    prisma.issue.findFirst.mockResolvedValue(null);

    const results = await revalidateRoomAccess(prisma as never, ISSUE_DOC, TEST_ORG.id, [
      TEST_USER.id,
    ]);

    expect(results.get(TEST_USER.id)).toEqual({
      reason: 'issue not found or archived',
      valid: false,
    });
  });

  it('matches the per-connection result revalidateAccess would produce for a guest', async () => {
    const prisma = mockPrisma();
    prisma.user.findMany.mockResolvedValue([{ active: true, id: TEST_USER.id }]);
    prisma.organization.findUnique.mockResolvedValue({ archivedAt: null, suspendedAt: null });
    prisma.issue.findFirst.mockResolvedValue({
      assigneeId: null,
      creatorId: 'some-other-user',
      teamId: TEST_TEAM.id,
    });
    prisma.teamMembership.findUnique.mockResolvedValue(TEST_TEAM_MEMBERSHIP);
    prisma.teamMemberRole.findUnique.mockResolvedValue({ role: 'guest' });

    const results = await revalidateRoomAccess(prisma as never, ISSUE_DOC, TEST_ORG.id, [
      TEST_USER.id,
    ]);

    expect(results.get(TEST_USER.id)).toEqual({
      reason: 'guest no longer has access to this issue',
      valid: false,
    });
  });
});
