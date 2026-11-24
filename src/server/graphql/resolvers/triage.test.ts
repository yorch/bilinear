import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockContext, type MockGraphQLContext } from '../../../test/context-mock';
import { TEST_ISSUE, TEST_ORG, TEST_TEAM, TEST_USER } from '../../../test/fixtures';
import { checkFixedWindow } from '../../middleware/rate-limit';
import { TriageNotInQueueError } from '../../services/triage.service';
import { DUPLICATE_SUGGESTION_RATE_LIMIT, triageResolvers } from './triage';

vi.mock('../../middleware/rate-limit', () => ({
  checkFixedWindow: vi.fn().mockResolvedValue({ count: 1, exceeded: false }),
}));

const ISSUE = { ...TEST_ISSUE, organizationId: TEST_ORG.id, teamId: TEST_TEAM.id };

describe('triageResolvers', () => {
  let ctx: MockGraphQLContext;

  beforeEach(() => {
    vi.mocked(checkFixedWindow).mockClear();
    ctx = createMockContext();
    ctx.prisma.issue.findUnique.mockResolvedValue(ISSUE);
    ctx.prisma.issue.findFirst.mockResolvedValue(ISSUE);
    ctx.prisma.teamMembership.findUnique.mockResolvedValue({
      team: { organizationId: TEST_ORG.id },
    });
    ctx.prisma.teamMembership.findMany.mockResolvedValue([]);
  });

  describe('lost races', () => {
    it('tags a not-in-queue failure with the stale reason (still BAD_USER_INPUT)', async () => {
      vi.spyOn(ctx.services.triage, 'decline').mockRejectedValue(new TriageNotInQueueError());
      await expect(
        triageResolvers.Mutation.issueTriageDecline({}, { issueId: ISSUE.id }, ctx as never),
      ).rejects.toMatchObject({
        extensions: { code: 'BAD_USER_INPUT', reason: 'TRIAGE_STALE' },
      });
    });

    it('does not tag other BAD_USER_INPUT failures as stale', async () => {
      const err = Object.assign(new Error('bad target'), {
        name: 'TriageInvalidTargetStateError',
      });
      vi.spyOn(ctx.services.triage, 'accept').mockRejectedValue(err);
      const rejection = await triageResolvers.Mutation.issueTriageAccept(
        {},
        { input: { stateId: 's' }, issueId: ISSUE.id },
        ctx as never,
      ).catch((e: { extensions: Record<string, unknown> }) => e);
      expect((rejection as { extensions: Record<string, unknown> }).extensions).toEqual({
        code: 'BAD_USER_INPUT',
      });
    });
  });

  describe('issueTriageRevert', () => {
    it('reverts, emits a D SyncAction per removed relation plus the issue update', async () => {
      const restored = { ...ISSUE, triagedAt: null };
      vi.spyOn(ctx.services.triage, 'revert').mockResolvedValue({
        issue: restored as never,
        removedRelationIds: ['rel-1', 'rel-2'],
      });
      const sync = vi.spyOn(ctx.services.sync, 'createSyncAction');
      const out = await triageResolvers.Mutation.issueTriageRevert(
        {},
        { issueId: ISSUE.id },
        ctx as never,
      );
      expect(out).toMatchObject({ lastSyncId: '1', success: true });
      expect(sync.mock.calls.map(c => c.slice(1, 4))).toEqual([
        ['D', 'IssueRelation', 'rel-1'],
        ['D', 'IssueRelation', 'rel-2'],
        ['U', 'Issue', ISSUE.id],
      ]);
    });

    it('requires team membership', async () => {
      ctx.prisma.teamMembership.findUnique.mockResolvedValue(null);
      const revert = vi.spyOn(ctx.services.triage, 'revert');
      await expect(
        triageResolvers.Mutation.issueTriageRevert({}, { issueId: ISSUE.id }, ctx as never),
      ).rejects.toMatchObject({ extensions: { code: 'FORBIDDEN' } });
      expect(revert).not.toHaveBeenCalled();
    });

    it('rejects an expired undo as stale', async () => {
      const { TriageNotRevertableError } = await import('../../services/triage.service');
      vi.spyOn(ctx.services.triage, 'revert').mockRejectedValue(new TriageNotRevertableError());
      await expect(
        triageResolvers.Mutation.issueTriageRevert({}, { issueId: ISSUE.id }, ctx as never),
      ).rejects.toMatchObject({ extensions: { reason: 'TRIAGE_STALE' } });
    });
  });

  describe('guests are not triagers', () => {
    // The caller is a guest of the issue's team and neither created nor owns it.
    beforeEach(() => {
      ctx.prisma.issue.findUnique.mockResolvedValue({
        ...ISSUE,
        assigneeId: null,
        creatorId: 'someone-else',
      });
      ctx.prisma.teamMemberRole.findUnique.mockResolvedValue({ role: 'guest' });
    });

    it.each([
      ['issueTriageAccept', { input: { stateId: 's' }, issueId: ISSUE.id }],
      ['issueTriageDecline', { issueId: ISSUE.id }],
      ['issueTriageMarkDuplicate', { canonicalIssueId: 'c', issueId: ISSUE.id }],
      ['issueTriageRevert', { issueId: ISSUE.id }],
      ['issueTriageSnooze', { issueId: ISSUE.id, until: '2999-01-01T00:00:00Z' }],
    ] as const)('%s is FORBIDDEN for a guest and touches nothing', async (name, args) => {
      const spies = ['accept', 'decline', 'markDuplicate', 'revert', 'snooze'].map(m =>
        vi.spyOn(ctx.services.triage, m as 'accept'),
      );
      await expect(
        (triageResolvers.Mutation[name] as (...a: unknown[]) => Promise<unknown>)(
          {},
          args,
          ctx as never,
        ),
      ).rejects.toMatchObject({ extensions: { code: 'FORBIDDEN' } });
      for (const spy of spies) {
        expect(spy).not.toHaveBeenCalled();
      }
    });

    it('triageQueue and triageQueueCount are FORBIDDEN for a guest', async () => {
      await expect(
        triageResolvers.Query.triageQueue({}, { teamId: TEST_TEAM.id }, ctx as never),
      ).rejects.toMatchObject({ extensions: { code: 'FORBIDDEN' } });
      await expect(
        triageResolvers.Query.triageQueueCount({}, { teamId: TEST_TEAM.id }, ctx as never),
      ).rejects.toMatchObject({ extensions: { code: 'FORBIDDEN' } });
    });

    it("triageDuplicateSuggestions is FORBIDDEN for a guest on someone else's issue", async () => {
      await expect(
        triageResolvers.Query.triageDuplicateSuggestions({}, { issueId: ISSUE.id }, ctx as never),
      ).rejects.toMatchObject({ extensions: { code: 'FORBIDDEN' } });
    });
  });

  describe('triageDuplicateSuggestions', () => {
    it('is rate limited per user, before any search work happens', async () => {
      vi.mocked(checkFixedWindow).mockResolvedValueOnce({ count: 999, exceeded: true });
      await expect(
        triageResolvers.Query.triageDuplicateSuggestions({}, { issueId: ISSUE.id }, ctx as never),
      ).rejects.toMatchObject({ extensions: { code: 'RATELIMITED' } });
      expect(checkFixedWindow).toHaveBeenCalledWith(
        expect.stringContaining(TEST_USER.id),
        DUPLICATE_SUGGESTION_RATE_LIMIT,
        60,
      );
      expect(ctx.prisma.teamMembership.findMany).not.toHaveBeenCalled();
    });
  });
});
