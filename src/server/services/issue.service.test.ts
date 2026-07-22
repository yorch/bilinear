import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_WORKFLOW_STATES,
  TEST_ISSUE,
  TEST_ORG,
  TEST_TEAM,
  TEST_USER,
} from '../../test/fixtures';
import { createMockPrisma, type MockPrismaClient } from '../../test/prisma-mock';
import {
  IssueInvalidReferenceError,
  IssueInvalidStateError,
  IssueService,
  IssueStateRequiredError,
  IssueValidationError,
} from './issue.service';

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

    it('invokes the txHook with the transaction client and created issue before returning', async () => {
      prisma.team.update.mockResolvedValue({ ...TEST_TEAM, issueCount: 1, key: 'ENG' });
      prisma.issue.create.mockResolvedValue(TEST_ISSUE);

      const seen: { issueId: string; sameTx: boolean } = { issueId: '', sameTx: false };
      await service.create(
        TEST_ORG.id,
        TEST_USER.id,
        { stateId: DEFAULT_WORKFLOW_STATES[0].id, teamId: TEST_TEAM.id, title: 'Hook' },
        async (tx, created) => {
          seen.issueId = created.id;
          // The hook receives the SAME mock client the writes ran on, so a
          // recordSyncAction(tx, …) lands in the same transaction.
          seen.sameTx = tx === (prisma as never);
        },
      );

      expect(seen.issueId).toBe(TEST_ISSUE.id);
      expect(seen.sameTx).toBe(true);
    });

    it('rolls back the issue write when the txHook throws (atomicity)', async () => {
      prisma.team.update.mockResolvedValue({ ...TEST_TEAM, issueCount: 1, key: 'ENG' });
      prisma.issue.create.mockResolvedValue(TEST_ISSUE);

      // A failing SyncAction write inside the hook must reject the whole
      // create — real Prisma rolls the transaction back, so no orphaned row.
      await expect(
        service.create(
          TEST_ORG.id,
          TEST_USER.id,
          { stateId: DEFAULT_WORKFLOW_STATES[0].id, teamId: TEST_TEAM.id, title: 'Boom' },
          async () => {
            throw new Error('sync write failed');
          },
        ),
      ).rejects.toThrow('sync write failed');
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
      // Inherited references must each resolve inside the caller's org —
      // validateReferences checks all three.
      prisma.project.findUnique.mockResolvedValue({ organizationId: TEST_ORG.id });
      prisma.cycle.findUnique.mockResolvedValue({
        organizationId: TEST_ORG.id,
        teamId: TEST_TEAM.id,
      });
      prisma.projectMilestone.findUnique.mockResolvedValue({
        project: { organizationId: TEST_ORG.id },
        projectId,
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
      // The explicit override project must resolve inside the caller's org.
      prisma.project.findUnique.mockResolvedValue({ organizationId: TEST_ORG.id });

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
      prisma.issueLabel.findMany.mockResolvedValue([
        { id: labelId, organizationId: TEST_ORG.id, parentId: null },
      ]);
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
    // update() now returns { issue, cascaded } and validates that any
    // caller-supplied stateId belongs to the same team. These defaults
    // satisfy the validation so tests not specifically exercising it
    // stay focused on the field being asserted.
    beforeEach(() => {
      prisma.issue.findUnique.mockResolvedValue({
        organizationId: TEST_ORG.id,
        teamId: TEST_TEAM.id,
      });
      prisma.workflowState.findFirst.mockResolvedValue({ teamId: TEST_TEAM.id });
    });

    it('updates individual fields', async () => {
      const updated = { ...TEST_ISSUE, priority: 2, title: 'Updated title' };
      prisma.issue.update.mockResolvedValue(updated);

      const result = await service.update(TEST_ISSUE.id, {
        priority: 2,
        title: 'Updated title',
      });

      expect(result.issue).toEqual(updated);
      expect(result.cascaded).toEqual([]);
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
      prisma.issueLabel.findMany.mockResolvedValue([
        { id: labelId, organizationId: TEST_ORG.id, parentId: null },
      ]);
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

    it('clears addedToProjectAt when projectId is set to null', async () => {
      prisma.issue.update.mockResolvedValue({ ...TEST_ISSUE, projectId: null });

      await service.update(TEST_ISSUE.id, { projectId: null });

      expect(prisma.issue.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ addedToProjectAt: null, projectId: null }),
        }),
      );
    });

    it('rejects a stateId from a different team', async () => {
      prisma.issue.findUnique.mockResolvedValue({ teamId: TEST_TEAM.id });
      prisma.workflowState.findFirst.mockResolvedValue({ teamId: 'different-team' });

      await expect(
        service.update(TEST_ISSUE.id, { stateId: COMPLETED_STATE.id }),
      ).rejects.toBeInstanceOf(IssueInvalidStateError);
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

  // Single-row issue mutations record their SyncAction inside the same
  // transaction as the write via a txHook (so a crash can't leave a row
  // without its replication marker). These assert the hook fires with the
  // SAME tx client and the affected row, and that a throwing hook rolls back.
  describe('sync atomicity (txHook)', () => {
    const sameTx = (tx: unknown) => tx === (prisma as never);

    it('archive invokes the hook with the tx client and archived row', async () => {
      const archived = { ...TEST_ISSUE, archivedAt: new Date() };
      prisma.issue.update.mockResolvedValue(archived);

      const seen: { id: string; tx: boolean } = { id: '', tx: false };
      await service.archive(TEST_ISSUE.id, async (tx, row) => {
        seen.id = row.id;
        seen.tx = sameTx(tx);
      });

      expect(seen).toEqual({ id: TEST_ISSUE.id, tx: true });
    });

    it('unarchive invokes the hook with the restored row', async () => {
      prisma.issue.update.mockResolvedValue({ ...TEST_ISSUE, archivedAt: null });
      let calledWith = '';
      await service.unarchive(TEST_ISSUE.id, async (_tx, row) => {
        calledWith = row.id;
      });
      expect(calledWith).toBe(TEST_ISSUE.id);
    });

    it('delete passes the just-deleted row to the hook', async () => {
      prisma.issue.delete.mockResolvedValue(TEST_ISSUE);
      let calledWith = '';
      await service.delete(TEST_ISSUE.id, async (_tx, row) => {
        calledWith = row.id;
      });
      expect(calledWith).toBe(TEST_ISSUE.id);
    });

    it('delete rejects (rolls back) when the hook throws', async () => {
      prisma.issue.delete.mockResolvedValue(TEST_ISSUE);
      await expect(
        service.delete(TEST_ISSUE.id, async () => {
          throw new Error('sync write failed');
        }),
      ).rejects.toThrow('sync write failed');
    });

    it('snooze invokes the hook with the snoozed row', async () => {
      const until = new Date(Date.now() + 60_000);
      prisma.issue.update.mockResolvedValue({ ...TEST_ISSUE, snoozedUntilAt: until });
      let calledWith = '';
      await service.snooze(TEST_ISSUE.id, TEST_USER.id, until, async (_tx, row) => {
        calledWith = row.id;
      });
      expect(calledWith).toBe(TEST_ISSUE.id);
    });

    it('unsnooze invokes the hook with the woken row', async () => {
      prisma.issue.update.mockResolvedValue({ ...TEST_ISSUE, snoozedUntilAt: null });
      let calledWith = '';
      await service.unsnooze(TEST_ISSUE.id, async (_tx, row) => {
        calledWith = row.id;
      });
      expect(calledWith).toBe(TEST_ISSUE.id);
    });

    it('addReaction invokes the hook with the upserted reaction', async () => {
      const reaction = {
        emoji: '👍',
        id: '00000000-0000-0000-0000-000000000901',
        issueId: TEST_ISSUE.id,
        userId: TEST_USER.id,
      };
      prisma.issue.findUnique.mockResolvedValue(TEST_ISSUE);
      prisma.issueReaction.upsert.mockResolvedValue({ ...reaction, user: TEST_USER });
      let calledWith = '';
      await service.addReaction(TEST_ISSUE.id, TEST_USER.id, '👍', async (_tx, row) => {
        calledWith = row.id;
      });
      expect(calledWith).toBe(reaction.id);
    });

    it('removeReaction invokes the hook with the removed reaction id', async () => {
      const reaction = {
        emoji: '👍',
        id: '00000000-0000-0000-0000-000000000902',
        issueId: TEST_ISSUE.id,
        userId: TEST_USER.id,
      };
      prisma.issueReaction.findUnique.mockResolvedValue(reaction);
      prisma.issueReaction.delete.mockResolvedValue(reaction);
      let calledWith = '';
      await service.removeReaction(TEST_ISSUE.id, TEST_USER.id, '👍', async (_tx, row) => {
        calledWith = row.id;
      });
      expect(calledWith).toBe(reaction.id);
    });

    it('bulkUpdate invokes the hook with every updated row in input order', async () => {
      const a = { ...TEST_ISSUE, id: '00000000-0000-0000-0000-0000000000a1' };
      const b = { ...TEST_ISSUE, id: '00000000-0000-0000-0000-0000000000a2' };
      // claim select (id/teamId) and the post-update re-read share this mock.
      prisma.issue.findMany.mockResolvedValue([a, b]);
      prisma.issue.updateMany.mockResolvedValue({ count: 2 });

      let seenIds: string[] = [];
      await service.bulkUpdate(TEST_ORG.id, [a.id, b.id], { priority: 2 }, async (_tx, rows) => {
        seenIds = rows.map(r => r.id);
      });

      expect(seenIds).toEqual([a.id, b.id]);
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
    // stateId validation now runs inside the transaction; provide
    // default mocks so the validation passes for the cascade tests.
    beforeEach(() => {
      prisma.issue.findUnique.mockResolvedValue({ teamId: TEST_TEAM.id });
      prisma.workflowState.findFirst.mockResolvedValue(COMPLETED_STATE);
    });

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

      // Parent should NOT have been closed — parent fetch only happens
      // after the sibling check passes. findUnique IS called once for the
      // in-tx stateId validation (selects only `teamId`), but the cascade
      // path's parent fetch (which selects `state`) must never run.
      const calls = prisma.issue.findUnique.mock.calls.map((c: unknown[]) => c[0]);
      const selectStateCalls = calls.filter(
        (call: unknown) => (call as { include?: { state?: unknown } }).include?.state !== undefined,
      );
      expect(selectStateCalls).toHaveLength(0);
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

      // workflowState.findFirst is now called once for the in-tx stateId
      // validation. The cascade-target lookup must NOT fire — the parent
      // is already in a terminal state, so we exit before looking for a
      // completed state to assign.
      expect(prisma.workflowState.findFirst).toHaveBeenCalledTimes(1);
    });
  });

  describe('maybeCloseChildren (via update)', () => {
    const mockTeamWithAutoCloseChildren = () => {
      prisma.team.findUnique.mockResolvedValue({
        autoCloseChildIssues: true,
        autoCloseParentIssues: false,
      });
    };
    // stateId validation now runs inside the transaction; provide
    // default mocks so the validation passes for the cascade tests.
    beforeEach(() => {
      prisma.issue.findUnique.mockResolvedValue({ teamId: TEST_TEAM.id });
      prisma.workflowState.findFirst.mockResolvedValue(COMPLETED_STATE);
    });

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

    it('orders by sortOrder with an id tiebreak for stable pagination', async () => {
      prisma.issue.findMany.mockResolvedValue([]);
      prisma.issue.count.mockResolvedValue(0);

      await service.findMany(TEST_ORG.id, {}, { first: 50 });

      expect(prisma.issue.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
        }),
      );
    });

    it('fetches one extra row and reports hasNextPage from the real remainder', async () => {
      // 3 rows returned for a page size of 2 — one extra row proves there's
      // a next page; the old `length === take` heuristic couldn't tell
      // "exactly 2 left" from "more than 2 left".
      prisma.issue.findMany.mockResolvedValue([
        { ...TEST_ISSUE, id: 'a' },
        { ...TEST_ISSUE, id: 'b' },
        { ...TEST_ISSUE, id: 'c' },
      ]);
      prisma.issue.count.mockResolvedValue(3);

      const result = await service.findMany(TEST_ORG.id, {}, { first: 2 });

      expect(prisma.issue.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 3 }));
      expect(result.nodes).toHaveLength(2);
      expect(result.nodes.map(n => n.id)).toEqual(['a', 'b']);
      expect(result.pageInfo.hasNextPage).toBe(true);
      expect(result.pageInfo.endCursor).toBe('b');
    });

    it('reports hasNextPage=false when the fetch returns exactly `take` rows', async () => {
      prisma.issue.findMany.mockResolvedValue([
        { ...TEST_ISSUE, id: 'a' },
        { ...TEST_ISSUE, id: 'b' },
      ]);
      prisma.issue.count.mockResolvedValue(2);

      const result = await service.findMany(TEST_ORG.id, {}, { first: 2 });

      expect(result.nodes).toHaveLength(2);
      expect(result.pageInfo.hasNextPage).toBe(false);
    });

    it('reports hasNextPage=true for the no-args default pagination when >50 rows exist', async () => {
      // Regression: hasNextPage used to be gated on `!!pagination.first`,
      // so a caller that omits BOTH `first` and `last` (a valid call — the
      // default take is 50) always got hasNextPage=false even though a
      // 51st row was over-fetched and hasMore was true, silently hiding
      // the fact that more rows exist past the first page.
      const rows = Array.from({ length: 51 }, (_, i) => ({ ...TEST_ISSUE, id: `row-${i}` }));
      prisma.issue.findMany.mockResolvedValue(rows);
      prisma.issue.count.mockResolvedValue(51);

      const result = await service.findMany(TEST_ORG.id, {}, {});

      expect(prisma.issue.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 51 }));
      expect(result.nodes).toHaveLength(50);
      expect(result.pageInfo.hasNextPage).toBe(true);
    });
  });

  describe('findByTeamId', () => {
    it('hides snoozed-not-yet-woken issues for a non-guest', async () => {
      prisma.issue.findMany.mockResolvedValue([]);

      await service.findByTeamId(TEST_TEAM.id);

      const call = prisma.issue.findMany.mock.calls[0][0];
      expect(call.where.AND).toEqual([
        { OR: [{ snoozedUntilAt: null }, { snoozedUntilAt: { lte: expect.any(Date) } }] },
      ]);
      expect(call.where.teamId).toBe(TEST_TEAM.id);
    });

    it('adds the creator/assignee restriction when guestUserId is supplied', async () => {
      prisma.issue.findMany.mockResolvedValue([]);

      await service.findByTeamId(TEST_TEAM.id, false, TEST_USER.id);

      const call = prisma.issue.findMany.mock.calls[0][0];
      // Built via the shared buildGuestVisibilityWhere helper (also used by
      // SearchService): the query is already pinned to `teamId` below, so
      // the `notIn: [teamId]` branch can never match — the predicate is
      // equivalent to plain creator-or-assignee, same as before extraction.
      expect(call.where.AND).toEqual(
        expect.arrayContaining([
          {
            OR: [
              { teamId: { notIn: [TEST_TEAM.id] } },
              { creatorId: TEST_USER.id },
              { assigneeId: TEST_USER.id },
            ],
          },
        ]),
      );
    });
  });

  describe('reactions', () => {
    const REACTION = {
      createdAt: new Date(),
      emoji: '👍',
      id: '00000000-0000-0000-0000-000000000900',
      issueId: TEST_ISSUE.id,
      userId: TEST_USER.id,
    };

    describe('addReaction', () => {
      it('upserts on the (issueId,userId,emoji) tuple', async () => {
        prisma.issue.findUnique.mockResolvedValue(TEST_ISSUE);
        prisma.issueReaction.upsert.mockResolvedValue({ ...REACTION, user: TEST_USER });

        const result = await service.addReaction(TEST_ISSUE.id, TEST_USER.id, '👍');

        expect(prisma.issueReaction.upsert).toHaveBeenCalledWith({
          create: { emoji: '👍', issueId: TEST_ISSUE.id, userId: TEST_USER.id },
          include: { user: true },
          update: {},
          where: {
            issueId_userId_emoji: {
              emoji: '👍',
              issueId: TEST_ISSUE.id,
              userId: TEST_USER.id,
            },
          },
        });
        expect(result.emoji).toBe('👍');
      });

      it('rejects with IssueNotFoundError when issue is missing', async () => {
        prisma.issue.findUnique.mockResolvedValue(null);
        await expect(service.addReaction(TEST_ISSUE.id, TEST_USER.id, '👍')).rejects.toThrow(
          'Issue not found',
        );
      });
    });

    describe('removeReaction', () => {
      it('deletes the matching reaction row', async () => {
        prisma.issueReaction.findUnique.mockResolvedValue(REACTION);
        prisma.issueReaction.delete.mockResolvedValue(REACTION);

        const result = await service.removeReaction(TEST_ISSUE.id, TEST_USER.id, '👍');

        expect(prisma.issueReaction.delete).toHaveBeenCalledWith({
          where: { id: REACTION.id },
        });
        expect(result).toEqual({ id: REACTION.id });
      });

      it('rejects with IssueReactionNotFoundError when nothing to remove', async () => {
        prisma.issueReaction.findUnique.mockResolvedValue(null);
        await expect(service.removeReaction(TEST_ISSUE.id, TEST_USER.id, '👍')).rejects.toThrow(
          'Reaction not found',
        );
      });
    });

    describe('listReactions', () => {
      it('returns reactions ordered by createdAt asc with user included', async () => {
        prisma.issueReaction.findMany.mockResolvedValue([{ ...REACTION, user: TEST_USER }]);

        const result = await service.listReactions(TEST_ISSUE.id);

        expect(prisma.issueReaction.findMany).toHaveBeenCalledWith({
          include: { user: true },
          orderBy: { createdAt: 'asc' },
          where: { issueId: TEST_ISSUE.id },
        });
        expect(result).toHaveLength(1);
      });
    });
  });

  describe('findByIdentifier', () => {
    it('queries by identifier and previousIdentifiers', async () => {
      prisma.issue.findFirst.mockResolvedValue(TEST_ISSUE);

      const result = await service.findByIdentifier(TEST_ORG.id, 'ENG-42');

      expect(result).toEqual(TEST_ISSUE);
      expect(prisma.issue.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: [{ identifier: 'ENG-42' }, { previousIdentifiers: { has: 'ENG-42' } }],
            organizationId: TEST_ORG.id,
          }),
        }),
      );
    });

    it('returns null when not found', async () => {
      prisma.issue.findFirst.mockResolvedValue(null);
      const result = await service.findByIdentifier(TEST_ORG.id, 'ENG-99');
      expect(result).toBeNull();
    });
  });

  describe('input validation caps', () => {
    beforeEach(() => {
      prisma.workflowState.findFirst.mockResolvedValue({ teamId: TEST_TEAM.id });
      prisma.team.update.mockResolvedValue({ ...TEST_TEAM, issueCount: 1 });
      prisma.issue.findUnique.mockResolvedValue({
        organizationId: TEST_ORG.id,
        teamId: TEST_TEAM.id,
      });
    });

    it('create rejects a title over the length cap', async () => {
      await expect(
        service.create(TEST_ORG.id, TEST_USER.id, {
          teamId: TEST_TEAM.id,
          title: 'a'.repeat(513),
        }),
      ).rejects.toThrow(IssueValidationError);
      expect(prisma.team.update).not.toHaveBeenCalled();
    });

    it('create rejects a description over the length cap', async () => {
      await expect(
        service.create(TEST_ORG.id, TEST_USER.id, {
          description: 'a'.repeat(100_001),
          teamId: TEST_TEAM.id,
          title: 'Test',
        }),
      ).rejects.toThrow(IssueValidationError);
    });

    it('create rejects an out-of-range priority', async () => {
      await expect(
        service.create(TEST_ORG.id, TEST_USER.id, {
          priority: 5,
          teamId: TEST_TEAM.id,
          title: 'Test',
        }),
      ).rejects.toThrow(IssueValidationError);
    });

    it('update rejects a title over the length cap', async () => {
      await expect(service.update(TEST_ISSUE.id, { title: 'a'.repeat(513) })).rejects.toThrow(
        IssueValidationError,
      );
      expect(prisma.issue.update).not.toHaveBeenCalled();
    });

    it('bulkUpdate rejects an out-of-range priority', async () => {
      await expect(
        service.bulkUpdate(TEST_ORG.id, [TEST_ISSUE.id], { priority: -1 }),
      ).rejects.toThrow(IssueValidationError);
    });
  });

  describe('cross-org / cross-team reference validation', () => {
    const FOREIGN_ID = '00000000-0000-0000-0000-0000000000f1';

    beforeEach(() => {
      prisma.workflowState.findFirst.mockResolvedValue({ teamId: TEST_TEAM.id });
      prisma.team.update.mockResolvedValue({ ...TEST_TEAM, issueCount: 1 });
      prisma.issue.create.mockResolvedValue(TEST_ISSUE);
      prisma.issueLabelAssignment.deleteMany.mockResolvedValue({ count: 0 });
    });

    it('create rejects a parentId belonging to a different org', async () => {
      prisma.issue.findUnique.mockResolvedValue({ organizationId: 'other-org' });

      await expect(
        service.create(TEST_ORG.id, TEST_USER.id, {
          parentId: FOREIGN_ID,
          stateId: DEFAULT_WORKFLOW_STATES[0].id,
          teamId: TEST_TEAM.id,
          title: 'Test',
        }),
      ).rejects.toThrow(IssueInvalidReferenceError);
      expect(prisma.issue.create).not.toHaveBeenCalled();
    });

    it('create rejects a nonexistent parentId', async () => {
      prisma.issue.findUnique.mockResolvedValue(null);

      await expect(
        service.create(TEST_ORG.id, TEST_USER.id, {
          parentId: FOREIGN_ID,
          stateId: DEFAULT_WORKFLOW_STATES[0].id,
          teamId: TEST_TEAM.id,
          title: 'Test',
        }),
      ).rejects.toThrow(IssueInvalidReferenceError);
    });

    it('create rejects a projectId belonging to a different org', async () => {
      prisma.project.findUnique.mockResolvedValue({ organizationId: 'other-org' });

      await expect(
        service.create(TEST_ORG.id, TEST_USER.id, {
          projectId: FOREIGN_ID,
          stateId: DEFAULT_WORKFLOW_STATES[0].id,
          teamId: TEST_TEAM.id,
          title: 'Test',
        }),
      ).rejects.toThrow(IssueInvalidReferenceError);
    });

    it('create rejects a cycleId belonging to a different team', async () => {
      prisma.cycle.findUnique.mockResolvedValue({
        organizationId: TEST_ORG.id,
        teamId: 'other-team',
      });

      await expect(
        service.create(TEST_ORG.id, TEST_USER.id, {
          cycleId: FOREIGN_ID,
          stateId: DEFAULT_WORKFLOW_STATES[0].id,
          teamId: TEST_TEAM.id,
          title: 'Test',
        }),
      ).rejects.toThrow(IssueInvalidReferenceError);
    });

    it('create rejects a projectMilestoneId whose project belongs to a different org', async () => {
      prisma.projectMilestone.findUnique.mockResolvedValue({
        project: { organizationId: 'other-org' },
        projectId: FOREIGN_ID,
      });

      await expect(
        service.create(TEST_ORG.id, TEST_USER.id, {
          projectMilestoneId: FOREIGN_ID,
          stateId: DEFAULT_WORKFLOW_STATES[0].id,
          teamId: TEST_TEAM.id,
          title: 'Test',
        }),
      ).rejects.toThrow(IssueInvalidReferenceError);
    });

    it('create rejects an assigneeId who is not an org member', async () => {
      prisma.organizationMember.findUnique.mockResolvedValue(null);

      await expect(
        service.create(TEST_ORG.id, TEST_USER.id, {
          assigneeId: FOREIGN_ID,
          stateId: DEFAULT_WORKFLOW_STATES[0].id,
          teamId: TEST_TEAM.id,
          title: 'Test',
        }),
      ).rejects.toThrow(IssueInvalidReferenceError);
    });

    it('create succeeds when every reference resolves inside the org/team', async () => {
      prisma.project.findUnique.mockResolvedValue({ organizationId: TEST_ORG.id });
      prisma.cycle.findUnique.mockResolvedValue({
        organizationId: TEST_ORG.id,
        teamId: TEST_TEAM.id,
      });
      prisma.organizationMember.findUnique.mockResolvedValue({ organizationId: TEST_ORG.id });

      await expect(
        service.create(TEST_ORG.id, TEST_USER.id, {
          assigneeId: FOREIGN_ID,
          cycleId: FOREIGN_ID,
          projectId: FOREIGN_ID,
          stateId: DEFAULT_WORKFLOW_STATES[0].id,
          teamId: TEST_TEAM.id,
          title: 'Test',
        }),
      ).resolves.toBeDefined();
    });

    it('update rejects a cross-org assigneeId', async () => {
      prisma.issue.findUnique.mockResolvedValue({
        organizationId: TEST_ORG.id,
        teamId: TEST_TEAM.id,
      });
      prisma.organizationMember.findUnique.mockResolvedValue(null);

      await expect(service.update(TEST_ISSUE.id, { assigneeId: FOREIGN_ID })).rejects.toThrow(
        IssueInvalidReferenceError,
      );
      expect(prisma.issue.update).not.toHaveBeenCalled();
    });

    it('update allows clearing a reference (null) without validating it', async () => {
      prisma.issue.findUnique.mockResolvedValue({
        organizationId: TEST_ORG.id,
        teamId: TEST_TEAM.id,
      });
      prisma.issue.update.mockResolvedValue(TEST_ISSUE);

      await service.update(TEST_ISSUE.id, { assigneeId: null, projectId: null });

      expect(prisma.organizationMember.findUnique).not.toHaveBeenCalled();
      expect(prisma.project.findUnique).not.toHaveBeenCalled();
    });

    it('bulkUpdate rejects a cross-org projectId across the whole batch', async () => {
      const a = { ...TEST_ISSUE, id: '00000000-0000-0000-0000-0000000000b1' };
      prisma.issue.findMany.mockResolvedValue([a]);
      prisma.project.findUnique.mockResolvedValue({ organizationId: 'other-org' });

      await expect(
        service.bulkUpdate(TEST_ORG.id, [a.id], { projectId: FOREIGN_ID }),
      ).rejects.toThrow(IssueInvalidReferenceError);
      expect(prisma.issue.updateMany).not.toHaveBeenCalled();
    });

    it('bulkUpdate rejects a cycleId that does not match every affected team', async () => {
      const a = { ...TEST_ISSUE, id: '00000000-0000-0000-0000-0000000000b2', teamId: 'team-a' };
      const b = { ...TEST_ISSUE, id: '00000000-0000-0000-0000-0000000000b3', teamId: 'team-b' };
      prisma.issue.findMany.mockResolvedValue([a, b]);
      prisma.cycle.findUnique.mockResolvedValue({ organizationId: TEST_ORG.id, teamId: 'team-a' });

      await expect(
        service.bulkUpdate(TEST_ORG.id, [a.id, b.id], { cycleId: FOREIGN_ID }),
      ).rejects.toThrow(IssueInvalidReferenceError);
    });
  });

  describe('bulkUpdate lifecycle timestamps', () => {
    const COMPLETED_STATE_ID = DEFAULT_WORKFLOW_STATES[3].id; // type: 'completed'

    it('stamps completedAt only on rows actually transitioning into the target state', async () => {
      const transitioning = {
        ...TEST_ISSUE,
        id: '00000000-0000-0000-0000-0000000000c1',
        startedAt: null,
        stateId: DEFAULT_WORKFLOW_STATES[2].id, // 'started' — not yet completed
      };
      const alreadyThere = {
        ...TEST_ISSUE,
        completedAt: new Date('2026-01-01T00:00:00Z'),
        id: '00000000-0000-0000-0000-0000000000c2',
        stateId: COMPLETED_STATE_ID, // already at the target state
      };
      prisma.issue.findMany.mockResolvedValue([transitioning, alreadyThere]);
      prisma.workflowState.findFirst.mockResolvedValue({
        teamId: TEST_TEAM.id,
        type: 'completed',
      });
      prisma.issue.updateMany.mockResolvedValue({ count: 1 });

      await service.bulkUpdate(TEST_ORG.id, [transitioning.id, alreadyThere.id], {
        stateId: COMPLETED_STATE_ID,
      });

      // One updateMany for the non-transitioning row (no lifecycle fields),
      // one for the transitioning row (stamped with completedAt/startedAt).
      expect(prisma.issue.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.not.objectContaining({ completedAt: expect.anything() }),
          where: expect.objectContaining({ id: { in: [alreadyThere.id] } }),
        }),
      );
      expect(prisma.issue.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ canceledAt: null, completedAt: expect.any(Date) }),
          where: expect.objectContaining({ id: { in: [transitioning.id] } }),
        }),
      );
    });

    it('applies first-set semantics for startedAt (only stamps if not already set)', async () => {
      const startedStateId = DEFAULT_WORKFLOW_STATES[2].id; // type: 'started'
      const needsStamp = {
        ...TEST_ISSUE,
        id: '00000000-0000-0000-0000-0000000000d1',
        startedAt: null,
        stateId: DEFAULT_WORKFLOW_STATES[1].id,
      };
      const alreadyStarted = {
        ...TEST_ISSUE,
        id: '00000000-0000-0000-0000-0000000000d2',
        startedAt: new Date('2026-01-01T00:00:00Z'),
        stateId: DEFAULT_WORKFLOW_STATES[1].id,
      };
      prisma.issue.findMany.mockResolvedValue([needsStamp, alreadyStarted]);
      prisma.workflowState.findFirst.mockResolvedValue({ teamId: TEST_TEAM.id, type: 'started' });
      prisma.issue.updateMany.mockResolvedValue({ count: 1 });

      await service.bulkUpdate(TEST_ORG.id, [needsStamp.id, alreadyStarted.id], {
        stateId: startedStateId,
      });

      expect(prisma.issue.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ startedAt: expect.any(Date) }),
          where: expect.objectContaining({ id: { in: [needsStamp.id] } }),
        }),
      );
      expect(prisma.issue.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.not.objectContaining({ startedAt: expect.anything() }),
          where: expect.objectContaining({ id: { in: [alreadyStarted.id] } }),
        }),
      );
    });

    it('does not touch lifecycle timestamps when the batch has no stateId change', async () => {
      const a = { ...TEST_ISSUE, id: '00000000-0000-0000-0000-0000000000e1' };
      prisma.issue.findMany.mockResolvedValue([a]);
      prisma.issue.updateMany.mockResolvedValue({ count: 1 });

      await service.bulkUpdate(TEST_ORG.id, [a.id], { priority: 3 });

      expect(prisma.issue.updateMany).toHaveBeenCalledTimes(1);
      expect(prisma.issue.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.not.objectContaining({ completedAt: expect.anything() }),
        }),
      );
    });
  });
});
