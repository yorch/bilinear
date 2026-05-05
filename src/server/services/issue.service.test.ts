import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_WORKFLOW_STATES,
  TEST_ISSUE,
  TEST_ORG,
  TEST_TEAM,
  TEST_USER,
} from '../../test/fixtures';
import { createMockPrisma, type MockPrismaClient } from '../../test/prisma-mock';
import { IssueInvalidStateError, IssueService, IssueStateRequiredError } from './issue.service';

const COMPLETED_STATE = DEFAULT_WORKFLOW_STATES[3]; // type: 'completed'
const CANCELED_STATE = DEFAULT_WORKFLOW_STATES[4]; // type: 'canceled'
const IN_PROGRESS_STATE = DEFAULT_WORKFLOW_STATES[2]; // type: 'started'

const PARENT_ISSUE = {
  ...TEST_ISSUE,
  id: '00000000-0000-0000-0000-000000000401',
  identifier: 'ENG-2',
  number: 2,
  parentId: null,
  state: { type: 'started' },
  stateId: IN_PROGRESS_STATE.id,
};

const CHILD_ISSUE = {
  ...TEST_ISSUE,
  id: '00000000-0000-0000-0000-000000000402',
  identifier: 'ENG-3',
  number: 3,
  parentId: PARENT_ISSUE.id,
  state: { type: 'started' },
  stateId: IN_PROGRESS_STATE.id,
};

describe('IssueService', () => {
  let prisma: MockPrismaClient;
  let service: IssueService;

  beforeEach(() => {
    prisma = createMockPrisma();
    service = new IssueService(prisma as never);
  });

  describe('create', () => {
    // create() now validates that a caller-supplied stateId belongs to
    // the same team. Default the lookup to a same-team match so tests
    // not specifically exercising that check stay focused.
    beforeEach(() => {
      prisma.workflowState.findFirst.mockResolvedValue({ teamId: TEST_TEAM.id });
    });
    it('atomically increments team.issueCount and generates identifier', async () => {
      const teamWithCount = { ...TEST_TEAM, issueCount: 1, key: 'ENG' };
      prisma.team.update.mockResolvedValue(teamWithCount);
      prisma.issue.create.mockResolvedValue(TEST_ISSUE);
      prisma.issueLabelAssignment.deleteMany.mockResolvedValue({ count: 0 });

      const result = await service.create(TEST_ORG.id, TEST_USER.id, {
        stateId: DEFAULT_WORKFLOW_STATES[0].id,
        teamId: TEST_TEAM.id,
        title: 'Test issue',
      });

      expect(prisma.team.update).toHaveBeenCalledWith({
        data: { issueCount: { increment: 1 } },
        where: { id: TEST_TEAM.id },
      });
      expect(prisma.issue.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            identifier: 'ENG-1',
            number: 1,
            title: 'Test issue',
          }),
        }),
      );
      expect(result).toEqual(TEST_ISSUE);
    });

    it('uses client-provided UUID when id is given', async () => {
      const customId = '12345678-1234-1234-1234-123456789abc';
      prisma.team.update.mockResolvedValue({ ...TEST_TEAM, issueCount: 1 });
      prisma.issue.create.mockResolvedValue({ ...TEST_ISSUE, id: customId });
      prisma.issueLabelAssignment.deleteMany.mockResolvedValue({ count: 0 });

      await service.create(TEST_ORG.id, TEST_USER.id, {
        id: customId,
        stateId: DEFAULT_WORKFLOW_STATES[0].id,
        teamId: TEST_TEAM.id,
        title: 'Test',
      });

      expect(prisma.issue.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ id: customId }),
        }),
      );
    });

    it('falls back to team.defaultIssueStateId when no stateId provided', async () => {
      const stateId = DEFAULT_WORKFLOW_STATES[0].id;
      prisma.team.update.mockResolvedValue({
        ...TEST_TEAM,
        defaultIssueStateId: stateId,
        issueCount: 1,
      });
      prisma.issue.create.mockResolvedValue(TEST_ISSUE);
      prisma.issueLabelAssignment.deleteMany.mockResolvedValue({ count: 0 });

      await service.create(TEST_ORG.id, TEST_USER.id, {
        teamId: TEST_TEAM.id,
        title: 'Test',
      });

      expect(prisma.issue.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ stateId }),
        }),
      );
    });

    it('rejects a stateId that belongs to a different team', async () => {
      // The state lookup returns a state pointing at some other team —
      // the same shape an attacker would get if they fed in another
      // team's workflow state id. Must throw, not silently misfile the
      // issue under a foreign team's state.
      prisma.workflowState.findFirst.mockReset();
      prisma.workflowState.findFirst.mockResolvedValue({ teamId: 'other-team-id' });
      prisma.team.update.mockResolvedValue({ ...TEST_TEAM, issueCount: 1 });

      await expect(
        service.create(TEST_ORG.id, TEST_USER.id, {
          stateId: DEFAULT_WORKFLOW_STATES[0].id,
          teamId: TEST_TEAM.id,
          title: 'Cross-team state',
        }),
      ).rejects.toThrow(IssueInvalidStateError);
    });

    it('throws IssueStateRequiredError when no state available', async () => {
      prisma.team.update.mockResolvedValue({
        ...TEST_TEAM,
        defaultIssueStateId: null,
        issueCount: 1,
      });

      await expect(
        service.create(TEST_ORG.id, TEST_USER.id, {
          teamId: TEST_TEAM.id,
          title: 'Test',
        }),
      ).rejects.toThrow(IssueStateRequiredError);
    });

    it('inherits project, milestone, and cycle from parent when not supplied', async () => {
      const projectId = '00000000-0000-0000-0000-000000000A01';
      const milestoneId = '00000000-0000-0000-0000-000000000A02';
      const cycleId = '00000000-0000-0000-0000-000000000A03';
      prisma.team.update.mockResolvedValue({ ...TEST_TEAM, issueCount: 4 });
      prisma.issue.findUnique.mockResolvedValue({
        ...PARENT_ISSUE,
        cycleId,
        projectId,
        projectMilestoneId: milestoneId,
      });
      prisma.issue.create.mockResolvedValue({
        ...CHILD_ISSUE,
        cycleId,
        projectId,
        projectMilestoneId: milestoneId,
      });

      await service.create(TEST_ORG.id, TEST_USER.id, {
        parentId: PARENT_ISSUE.id,
        stateId: DEFAULT_WORKFLOW_STATES[0].id,
        teamId: TEST_TEAM.id,
        title: 'Child',
      });

      expect(prisma.issue.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            cycleId,
            parentId: PARENT_ISSUE.id,
            projectId,
            projectMilestoneId: milestoneId,
          }),
        }),
      );
    });

    it('keeps explicit project/cycle overrides and drops inherited milestone when projects differ', async () => {
      const parentProjectId = '00000000-0000-0000-0000-000000000B01';
      const parentMilestoneId = '00000000-0000-0000-0000-000000000B02';
      const overrideProjectId = '00000000-0000-0000-0000-000000000B03';
      prisma.team.update.mockResolvedValue({ ...TEST_TEAM, issueCount: 5 });
      prisma.issue.findUnique.mockResolvedValue({
        ...PARENT_ISSUE,
        cycleId: null,
        projectId: parentProjectId,
        projectMilestoneId: parentMilestoneId,
      });
      prisma.issue.create.mockResolvedValue(CHILD_ISSUE);

      await service.create(TEST_ORG.id, TEST_USER.id, {
        parentId: PARENT_ISSUE.id,
        projectId: overrideProjectId,
        stateId: DEFAULT_WORKFLOW_STATES[0].id,
        teamId: TEST_TEAM.id,
        title: 'Child',
      });

      expect(prisma.issue.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            projectId: overrideProjectId,
            // milestone not inherited because the child is in a different project
            projectMilestoneId: undefined,
          }),
        }),
      );
    });

    it('creates label assignments when labelIds provided', async () => {
      const labelId = '00000000-0000-0000-0000-000000000500';
      prisma.team.update.mockResolvedValue({ ...TEST_TEAM, issueCount: 1 });
      prisma.issue.create.mockResolvedValue(TEST_ISSUE);
      prisma.issueLabelAssignment.deleteMany.mockResolvedValue({ count: 0 });
      prisma.issueLabelAssignment.createMany.mockResolvedValue({ count: 1 });

      await service.create(TEST_ORG.id, TEST_USER.id, {
        labelIds: [labelId],
        stateId: DEFAULT_WORKFLOW_STATES[0].id,
        teamId: TEST_TEAM.id,
        title: 'Test',
      });

      expect(prisma.issueLabelAssignment.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: [{ issueId: TEST_ISSUE.id, labelId }],
        }),
      );
    });
  });

  describe('findById', () => {
    it('returns issue with label assignments when found', async () => {
      prisma.issue.findUnique.mockResolvedValue(TEST_ISSUE);
      const result = await service.findById(TEST_ISSUE.id);
      expect(result).toEqual(TEST_ISSUE);
      expect(prisma.issue.findUnique).toHaveBeenCalledWith({
        include: { labelAssignments: { include: { label: true } } },
        where: { id: TEST_ISSUE.id },
      });
    });

    it('returns null when not found', async () => {
      prisma.issue.findUnique.mockResolvedValue(null);
      const result = await service.findById('nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('update', () => {
    it('updates individual fields', async () => {
      const updated = { ...TEST_ISSUE, priority: 2, title: 'Updated title' };
      prisma.issue.update.mockResolvedValue(updated);

      const result = await service.update(TEST_ISSUE.id, {
        priority: 2,
        title: 'Updated title',
      });

      expect(result).toEqual(updated);
      expect(prisma.issue.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            priority: 2,
            title: 'Updated title',
          }),
          where: { id: TEST_ISSUE.id },
        }),
      );
    });

    it('syncs labels when labelIds provided', async () => {
      const labelId = '00000000-0000-0000-0000-000000000500';
      prisma.issue.update.mockResolvedValue(TEST_ISSUE);
      prisma.issueLabelAssignment.deleteMany.mockResolvedValue({ count: 0 });
      prisma.issueLabelAssignment.createMany.mockResolvedValue({ count: 1 });

      await service.update(TEST_ISSUE.id, { labelIds: [labelId] });

      expect(prisma.issueLabelAssignment.deleteMany).toHaveBeenCalledWith({
        where: { issueId: TEST_ISSUE.id },
      });
      expect(prisma.issueLabelAssignment.createMany).toHaveBeenCalled();
    });

    it('clears labels when labelIds is empty array', async () => {
      prisma.issue.update.mockResolvedValue(TEST_ISSUE);
      prisma.issueLabelAssignment.deleteMany.mockResolvedValue({ count: 2 });

      await service.update(TEST_ISSUE.id, { labelIds: [] });

      expect(prisma.issueLabelAssignment.deleteMany).toHaveBeenCalled();
      expect(prisma.issueLabelAssignment.createMany).not.toHaveBeenCalled();
    });

    it('clears assignee when null is passed', async () => {
      prisma.issue.update.mockResolvedValue({
        ...TEST_ISSUE,
        assigneeId: null,
      });

      await service.update(TEST_ISSUE.id, { assigneeId: null });

      expect(prisma.issue.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ assigneeId: null }),
        }),
      );
    });
  });

  describe('archive / unarchive', () => {
    it('sets archivedAt on archive', async () => {
      const now = new Date();
      prisma.issue.update.mockResolvedValue({ ...TEST_ISSUE, archivedAt: now });

      const result = await service.archive(TEST_ISSUE.id);
      expect(result.archivedAt).not.toBeNull();
      expect(prisma.issue.update).toHaveBeenCalledWith({
        data: { archivedAt: expect.any(Date) },
        where: { id: TEST_ISSUE.id },
      });
    });

    it('clears archivedAt on unarchive', async () => {
      prisma.issue.update.mockResolvedValue({
        ...TEST_ISSUE,
        archivedAt: null,
      });

      const result = await service.unarchive(TEST_ISSUE.id);
      expect(result.archivedAt).toBeNull();
      expect(prisma.issue.update).toHaveBeenCalledWith({
        data: { archivedAt: null },
        where: { id: TEST_ISSUE.id },
      });
    });
  });

  describe('delete', () => {
    it('hard-deletes the issue', async () => {
      prisma.issue.delete.mockResolvedValue(TEST_ISSUE);

      await service.delete(TEST_ISSUE.id);
      expect(prisma.issue.delete).toHaveBeenCalledWith({
        where: { id: TEST_ISSUE.id },
      });
    });
  });

  describe('maybeCloseParent (via update)', () => {
    // Every test in this block assumes autoCloseParentIssues is on — gate
    // flags were added in Sprint 25-26 close-out work.
    const mockTeamWithAutoCloseParent = () => {
      prisma.team.findUnique.mockResolvedValue({
        autoCloseChildIssues: false,
        autoCloseParentIssues: true,
      });
    };

    it('closes parent when last child is completed', async () => {
      mockTeamWithAutoCloseParent();
      // update() returns child issue with parentId set
      const updatedChild = {
        ...CHILD_ISSUE,
        stateId: COMPLETED_STATE.id,
      };
      // First call: child update inside $transaction
      prisma.issue.update.mockResolvedValueOnce(updatedChild);
      prisma.issueLabelAssignment.deleteMany.mockResolvedValue({ count: 0 });

      // siblings query — only the child itself, now completed
      prisma.issue.findMany.mockResolvedValue([
        { id: CHILD_ISSUE.id, state: { type: 'completed' } },
      ]);
      // parent fetch — not yet done
      prisma.issue.findUnique.mockResolvedValue({
        ...PARENT_ISSUE,
        state: { type: 'started' },
      });
      // completed state lookup
      prisma.workflowState.findFirst.mockResolvedValue(COMPLETED_STATE);
      // Second call: parent close update
      prisma.issue.update.mockResolvedValueOnce({
        ...PARENT_ISSUE,
        completedAt: new Date(),
        stateId: COMPLETED_STATE.id,
      });

      await service.update(CHILD_ISSUE.id, { stateId: COMPLETED_STATE.id });

      // Verify the parent was closed
      expect(prisma.issue.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            completedAt: expect.any(Date),
            stateId: COMPLETED_STATE.id,
          }),
          where: { id: PARENT_ISSUE.id },
        }),
      );
    });

    it('counts canceled children as done for parent-close check', async () => {
      mockTeamWithAutoCloseParent();
      const updatedChild = {
        ...CHILD_ISSUE,
        stateId: CANCELED_STATE.id,
      };
      // First call: child update inside $transaction
      prisma.issue.update.mockResolvedValueOnce(updatedChild);
      prisma.issueLabelAssignment.deleteMany.mockResolvedValue({ count: 0 });

      // Two siblings: one completed, one canceled → all done
      prisma.issue.findMany.mockResolvedValue([
        { id: 'sibling-1', state: { type: 'completed' } },
        { id: CHILD_ISSUE.id, state: { type: 'canceled' } },
      ]);
      prisma.issue.findUnique.mockResolvedValue({
        ...PARENT_ISSUE,
        state: { type: 'started' },
      });
      prisma.workflowState.findFirst.mockResolvedValue(COMPLETED_STATE);
      // Second call: parent close update
      prisma.issue.update.mockResolvedValueOnce({
        ...PARENT_ISSUE,
        completedAt: new Date(),
        stateId: COMPLETED_STATE.id,
      });

      await service.update(CHILD_ISSUE.id, { stateId: CANCELED_STATE.id });

      expect(prisma.workflowState.findFirst).toHaveBeenCalled();
      expect(prisma.issue.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: PARENT_ISSUE.id },
        }),
      );
    });

    it('does not close parent when sibling is still in progress', async () => {
      mockTeamWithAutoCloseParent();
      const updatedChild = {
        ...CHILD_ISSUE,
        stateId: COMPLETED_STATE.id,
      };
      prisma.issue.update.mockResolvedValue(updatedChild);
      prisma.issueLabelAssignment.deleteMany.mockResolvedValue({ count: 0 });

      // One sibling still in progress
      prisma.issue.findMany.mockResolvedValue([
        { id: CHILD_ISSUE.id, state: { type: 'completed' } },
        { id: 'sibling-2', state: { type: 'started' } },
      ]);

      await service.update(CHILD_ISSUE.id, { stateId: COMPLETED_STATE.id });

      // Parent should NOT have been closed — parent fetch only happens after
      // the sibling check passes.
      expect(prisma.issue.findUnique).not.toHaveBeenCalled();
    });

    it('does not close parent when autoCloseParentIssues flag is off', async () => {
      // Team does not opt into the cascade — even though all siblings are done.
      prisma.team.findUnique.mockResolvedValue({
        autoCloseChildIssues: false,
        autoCloseParentIssues: false,
      });
      prisma.issue.update.mockResolvedValue({
        ...CHILD_ISSUE,
        stateId: COMPLETED_STATE.id,
      });
      prisma.issueLabelAssignment.deleteMany.mockResolvedValue({ count: 0 });

      await service.update(CHILD_ISSUE.id, { stateId: COMPLETED_STATE.id });

      // With the flag off, the cascade helper never runs — no sibling lookup.
      expect(prisma.issue.findMany).not.toHaveBeenCalled();
    });

    it('does not close parent when parent is already completed', async () => {
      mockTeamWithAutoCloseParent();
      const updatedChild = {
        ...CHILD_ISSUE,
        stateId: COMPLETED_STATE.id,
      };
      prisma.issue.update.mockResolvedValue(updatedChild);
      prisma.issueLabelAssignment.deleteMany.mockResolvedValue({ count: 0 });

      prisma.issue.findMany.mockResolvedValue([
        { id: CHILD_ISSUE.id, state: { type: 'completed' } },
      ]);
      // Parent already done
      prisma.issue.findUnique.mockResolvedValue({
        ...PARENT_ISSUE,
        state: { type: 'completed' },
      });

      await service.update(CHILD_ISSUE.id, { stateId: COMPLETED_STATE.id });

      // workflowState.findFirst should not have been called
      expect(prisma.workflowState.findFirst).not.toHaveBeenCalled();
    });
  });

  describe('maybeCloseChildren (via update)', () => {
    const mockTeamWithAutoCloseChildren = () => {
      prisma.team.findUnique.mockResolvedValue({
        autoCloseChildIssues: true,
        autoCloseParentIssues: false,
      });
    };

    it('closes open children when parent moves to completed', async () => {
      const updatedParent = {
        ...PARENT_ISSUE,
        parentId: null,
        stateId: COMPLETED_STATE.id,
      };
      prisma.issue.update.mockResolvedValueOnce(updatedParent);
      prisma.issueLabelAssignment.deleteMany.mockResolvedValue({ count: 0 });
      mockTeamWithAutoCloseChildren();

      // parent state lookup (post-update)
      prisma.workflowState.findUnique.mockResolvedValue({ type: 'completed' });
      // two children: one open, one already done (won't be touched)
      prisma.issue.findMany.mockResolvedValue([
        { id: 'child-open', state: { type: 'started' } },
        { id: 'child-done', state: { type: 'completed' } },
      ]);
      prisma.workflowState.findFirst.mockResolvedValue(COMPLETED_STATE);
      prisma.issue.updateMany.mockResolvedValue({ count: 1 });

      await service.update(PARENT_ISSUE.id, { stateId: COMPLETED_STATE.id });

      expect(prisma.issue.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            completedAt: expect.any(Date),
            stateId: COMPLETED_STATE.id,
          }),
          where: { id: { in: ['child-open'] } },
        }),
      );
    });

    it('no-ops when parent does not move into a terminal state', async () => {
      const updatedParent = {
        ...PARENT_ISSUE,
        parentId: null,
        stateId: IN_PROGRESS_STATE.id,
      };
      prisma.issue.update.mockResolvedValue(updatedParent);
      prisma.issueLabelAssignment.deleteMany.mockResolvedValue({ count: 0 });
      mockTeamWithAutoCloseChildren();

      prisma.workflowState.findUnique.mockResolvedValue({ type: 'started' });

      await service.update(PARENT_ISSUE.id, { stateId: IN_PROGRESS_STATE.id });

      // No children lookup because parent didn't close
      expect(prisma.issue.findMany).not.toHaveBeenCalled();
      expect(prisma.issue.updateMany).not.toHaveBeenCalled();
    });

    it('does nothing when flag is off', async () => {
      prisma.team.findUnique.mockResolvedValue({
        autoCloseChildIssues: false,
        autoCloseParentIssues: false,
      });
      prisma.issue.update.mockResolvedValue({
        ...PARENT_ISSUE,
        parentId: null,
        stateId: COMPLETED_STATE.id,
      });
      prisma.issueLabelAssignment.deleteMany.mockResolvedValue({ count: 0 });

      await service.update(PARENT_ISSUE.id, { stateId: COMPLETED_STATE.id });

      expect(prisma.workflowState.findUnique).not.toHaveBeenCalled();
      expect(prisma.issue.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('findMany', () => {
    it('returns paginated issues with totalCount', async () => {
      prisma.issue.findMany.mockResolvedValue([TEST_ISSUE]);
      prisma.issue.count.mockResolvedValue(1);

      const result = await service.findMany(TEST_ORG.id, {}, { first: 50 });

      expect(result.nodes).toHaveLength(1);
      expect(result.totalCount).toBe(1);
      expect(result.pageInfo.hasNextPage).toBe(false);
    });

    it('filters by teamId', async () => {
      prisma.issue.findMany.mockResolvedValue([]);
      prisma.issue.count.mockResolvedValue(0);

      await service.findMany(TEST_ORG.id, { teamId: TEST_TEAM.id }, { first: 50 });

      expect(prisma.issue.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ teamId: TEST_TEAM.id }),
        }),
      );
    });

    it('excludes archived issues by default', async () => {
      prisma.issue.findMany.mockResolvedValue([]);
      prisma.issue.count.mockResolvedValue(0);

      await service.findMany(TEST_ORG.id, {}, { first: 50 });

      expect(prisma.issue.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ archivedAt: null }),
        }),
      );
    });

    it('includes archived issues when includeArchived=true', async () => {
      prisma.issue.findMany.mockResolvedValue([]);
      prisma.issue.count.mockResolvedValue(0);

      await service.findMany(TEST_ORG.id, {}, { first: 50 }, true);

      const call = prisma.issue.findMany.mock.calls[0][0];
      expect(call.where.archivedAt).toBeUndefined();
    });
  });
});
