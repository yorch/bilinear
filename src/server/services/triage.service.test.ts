import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_WORKFLOW_STATES, TEST_ISSUE, TEST_TEAM } from '../../test/fixtures';
import { createMockPrisma, type MockPrismaClient } from '../../test/prisma-mock';
import {
  TriageCrossOrgError,
  TriageDuplicateSelfError,
  TriageIssueNotFoundError,
  TriageNotEnabledError,
  TriageNotInQueueError,
  TriageService,
  TriageSnoozeInvalidDateError,
} from './triage.service';

const TRIAGE_STATE = {
  archivedAt: null,
  color: '#e2e2e2',
  createdAt: new Date('2026-01-15T00:00:00Z'),
  description: null,
  id: '00000000-0000-0000-0000-000000000299',
  name: 'Triage',
  position: 0,
  teamId: TEST_TEAM.id,
  type: 'triage',
  updatedAt: new Date('2026-01-15T00:00:00Z'),
};

const CANCELED_STATE = DEFAULT_WORKFLOW_STATES[4]; // type: 'canceled'

const TRIAGE_ISSUE = { ...TEST_ISSUE, stateId: TRIAGE_STATE.id };

describe('TriageService', () => {
  let prisma: MockPrismaClient;
  let service: TriageService;

  beforeEach(() => {
    prisma = createMockPrisma();
    service = new TriageService(prisma as never);
  });

  describe('getQueue', () => {
    it('returns empty list when team has no triage state', async () => {
      prisma.workflowState.findFirst.mockResolvedValue(null);
      const result = await service.getQueue(TEST_TEAM.id);
      expect(result).toEqual([]);
      expect(prisma.issue.findMany).not.toHaveBeenCalled();
    });

    it('returns issues in the triage state, excluding snoozed-and-future', async () => {
      prisma.workflowState.findFirst.mockResolvedValue({ id: TRIAGE_STATE.id });
      prisma.issue.findMany.mockResolvedValue([TRIAGE_ISSUE]);
      const result = await service.getQueue(TEST_TEAM.id);
      expect(result).toEqual([TRIAGE_ISSUE]);
      expect(prisma.issue.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ stateId: TRIAGE_STATE.id }),
        }),
      );
    });
  });

  describe('accept', () => {
    it('moves an issue out of triage and stamps triagedAt', async () => {
      prisma.issue.findUnique.mockResolvedValue(TRIAGE_ISSUE);
      // 1: triage state lookup, 2: target state same-team check
      prisma.workflowState.findFirst
        .mockResolvedValueOnce({ id: TRIAGE_STATE.id })
        .mockResolvedValueOnce({ id: 'target-state', teamId: TRIAGE_ISSUE.teamId });
      prisma.issue.updateMany.mockResolvedValue({ count: 1 });
      prisma.issue.findUnique
        .mockResolvedValueOnce(TRIAGE_ISSUE)
        .mockResolvedValueOnce({ ...TRIAGE_ISSUE, stateId: 'target-state' });

      await service.accept(TRIAGE_ISSUE.id, { stateId: 'target-state' });

      expect(prisma.issue.updateMany).toHaveBeenCalledWith({
        data: expect.objectContaining({
          stateId: 'target-state',
          triagedAt: expect.any(Date),
        }),
        where: { id: TRIAGE_ISSUE.id, stateId: TRIAGE_STATE.id },
      });
    });

    it('throws TriageNotInQueueError when issue is not in triage state', async () => {
      prisma.issue.findUnique.mockResolvedValue({ ...TEST_ISSUE });
      prisma.workflowState.findFirst.mockResolvedValue({ id: TRIAGE_STATE.id });

      await expect(service.accept(TEST_ISSUE.id, { stateId: 'target-state' })).rejects.toThrow(
        TriageNotInQueueError,
      );
    });

    it('throws TriageNotEnabledError when team has no triage state', async () => {
      prisma.issue.findUnique.mockResolvedValue(TRIAGE_ISSUE);
      prisma.workflowState.findFirst.mockResolvedValue(null);

      await expect(service.accept(TRIAGE_ISSUE.id, { stateId: 'target-state' })).rejects.toThrow(
        TriageNotEnabledError,
      );
    });

    it('rejects target stateId from a different team', async () => {
      prisma.issue.findUnique.mockResolvedValue(TRIAGE_ISSUE);
      prisma.workflowState.findFirst
        .mockResolvedValueOnce({ id: TRIAGE_STATE.id })
        .mockResolvedValueOnce({ id: 'foreign-state', teamId: 'other-team-id' });

      await expect(service.accept(TRIAGE_ISSUE.id, { stateId: 'foreign-state' })).rejects.toThrow(
        /same team/,
      );
    });

    it('clears stale canceledAt when re-accepting a re-routed issue', async () => {
      // Scenario: issue was previously declined (canceledAt set), someone
      // manually moved its stateId back to triage, now we accept again.
      // The CAS update should reset canceledAt to null.
      const previouslyCancelled = {
        ...TRIAGE_ISSUE,
        canceledAt: new Date('2026-01-01'),
      };
      prisma.issue.findUnique.mockResolvedValue(previouslyCancelled);
      prisma.workflowState.findFirst
        .mockResolvedValueOnce({ id: TRIAGE_STATE.id })
        .mockResolvedValueOnce({ id: 'target-state', teamId: TRIAGE_ISSUE.teamId });
      prisma.issue.updateMany.mockResolvedValue({ count: 1 });
      prisma.issue.findUnique.mockResolvedValueOnce(previouslyCancelled).mockResolvedValueOnce({
        ...previouslyCancelled,
        canceledAt: null,
        stateId: 'target-state',
      });

      await service.accept(TRIAGE_ISSUE.id, { stateId: 'target-state' });

      expect(prisma.issue.updateMany).toHaveBeenCalledWith({
        data: expect.objectContaining({
          canceledAt: null,
          stateId: 'target-state',
          triagedAt: expect.any(Date),
        }),
        where: { id: TRIAGE_ISSUE.id, stateId: TRIAGE_STATE.id },
      });
    });
  });

  describe('decline', () => {
    it('cancels the issue with canceledAt and triagedAt', async () => {
      prisma.issue.findUnique
        .mockResolvedValueOnce(TRIAGE_ISSUE)
        .mockResolvedValueOnce({ ...TRIAGE_ISSUE, stateId: CANCELED_STATE.id });
      prisma.workflowState.findFirst
        .mockResolvedValueOnce({ id: TRIAGE_STATE.id })
        .mockResolvedValueOnce({ id: CANCELED_STATE.id });
      prisma.issue.updateMany.mockResolvedValue({ count: 1 });

      await service.decline(TRIAGE_ISSUE.id);

      expect(prisma.issue.updateMany).toHaveBeenCalledWith({
        data: expect.objectContaining({
          canceledAt: expect.any(Date),
          stateId: CANCELED_STATE.id,
          triagedAt: expect.any(Date),
        }),
        where: { id: TRIAGE_ISSUE.id, stateId: TRIAGE_STATE.id },
      });
    });

    it('throws TriageNotInQueueError when issue raced out of triage', async () => {
      prisma.issue.findUnique.mockResolvedValue(TRIAGE_ISSUE);
      prisma.workflowState.findFirst
        .mockResolvedValueOnce({ id: TRIAGE_STATE.id })
        .mockResolvedValueOnce({ id: CANCELED_STATE.id });
      // CAS returns 0 — the row was moved out of triage between findUnique and updateMany.
      prisma.issue.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.decline(TRIAGE_ISSUE.id)).rejects.toThrow(TriageNotInQueueError);
    });
  });

  describe('markDuplicate', () => {
    it('rejects self-reference', async () => {
      await expect(service.markDuplicate(TRIAGE_ISSUE.id, TRIAGE_ISSUE.id)).rejects.toThrow(
        TriageDuplicateSelfError,
      );
    });

    it('rejects cross-org duplicates', async () => {
      const crossOrg = {
        ...TEST_ISSUE,
        id: 'aaaaaaaa-0000-0000-0000-000000000999',
        organizationId: '99999999-0000-0000-0000-000000000000',
      };
      prisma.issue.findUnique.mockResolvedValueOnce(TRIAGE_ISSUE).mockResolvedValueOnce(crossOrg);
      await expect(service.markDuplicate(TRIAGE_ISSUE.id, crossOrg.id)).rejects.toThrow(
        TriageCrossOrgError,
      );
    });

    it('throws TriageIssueNotFoundError when canonical issue is missing', async () => {
      prisma.issue.findUnique.mockResolvedValueOnce(TRIAGE_ISSUE).mockResolvedValueOnce(null);
      await expect(service.markDuplicate(TRIAGE_ISSUE.id, 'missing')).rejects.toThrow(
        TriageIssueNotFoundError,
      );
    });
  });

  describe('snooze', () => {
    it('rejects past dates', async () => {
      await expect(
        service.snooze(TRIAGE_ISSUE.id, new Date('2020-01-01'), 'user-id'),
      ).rejects.toThrow(TriageSnoozeInvalidDateError);
    });

    it('updates snoozedUntilAt and snoozedById via atomic CAS', async () => {
      const future = new Date(Date.now() + 60_000);
      prisma.issue.findUnique.mockResolvedValueOnce(TRIAGE_ISSUE).mockResolvedValueOnce({
        ...TRIAGE_ISSUE,
        snoozedById: 'user-id',
        snoozedUntilAt: future,
      });
      prisma.workflowState.findFirst.mockResolvedValue({ id: TRIAGE_STATE.id });
      prisma.issue.updateMany.mockResolvedValue({ count: 1 });

      await service.snooze(TRIAGE_ISSUE.id, future, 'user-id');

      expect(prisma.issue.updateMany).toHaveBeenCalledWith({
        data: { snoozedById: 'user-id', snoozedUntilAt: future },
        where: { id: TRIAGE_ISSUE.id, stateId: TRIAGE_STATE.id },
      });
    });

    it('throws TriageNotInQueueError when issue raced out of triage', async () => {
      const future = new Date(Date.now() + 60_000);
      prisma.issue.findUnique.mockResolvedValue(TRIAGE_ISSUE);
      prisma.workflowState.findFirst.mockResolvedValue({ id: TRIAGE_STATE.id });
      prisma.issue.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.snooze(TRIAGE_ISSUE.id, future, 'user-id')).rejects.toThrow(
        TriageNotInQueueError,
      );
    });
  });
});
