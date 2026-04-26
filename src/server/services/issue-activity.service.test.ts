import { beforeEach, describe, expect, it } from 'vitest';
import { createMockPrisma, type MockPrismaClient } from '../../test/prisma-mock';
import { IssueActivityService } from './issue-activity.service';

const ISSUE_ID = '00000000-0000-0000-0000-000000000400';
const ACTOR_ID = '00000000-0000-0000-0000-000000000001';

const makeActivity = (id: string, field: string) => ({
  actorId: ACTOR_ID,
  createdAt: new Date('2026-02-15T00:00:00Z'),
  field,
  id,
  issueId: ISSUE_ID,
  newValue: 'new',
  oldValue: 'old',
});

describe('IssueActivityService', () => {
  let prisma: MockPrismaClient;
  let service: IssueActivityService;

  beforeEach(() => {
    prisma = createMockPrisma();
    service = new IssueActivityService(prisma as never);
  });

  describe('create', () => {
    it('creates a single activity entry', async () => {
      const activity = makeActivity('act-1', 'stateId');
      prisma.issueActivity.create.mockResolvedValue(activity);

      const result = await service.create({
        actorId: ACTOR_ID,
        field: 'stateId',
        issueId: ISSUE_ID,
        newValue: 'new',
        oldValue: 'old',
      });

      expect(prisma.issueActivity.create).toHaveBeenCalledWith({
        data: {
          actorId: ACTOR_ID,
          field: 'stateId',
          issueId: ISSUE_ID,
          newValue: 'new',
          oldValue: 'old',
        },
      });
      expect(result).toEqual(activity);
    });

    it('maps undefined optional fields to null', async () => {
      const activity = makeActivity('act-2', 'priority');
      activity.actorId = null as never;
      activity.oldValue = null as never;
      activity.newValue = null as never;
      prisma.issueActivity.create.mockResolvedValue(activity);

      await service.create({ field: 'priority', issueId: ISSUE_ID });

      expect(prisma.issueActivity.create).toHaveBeenCalledWith({
        data: {
          actorId: null,
          field: 'priority',
          issueId: ISSUE_ID,
          newValue: null,
          oldValue: null,
        },
      });
    });
  });

  describe('createMany', () => {
    it('returns empty array without touching the db when activities is empty', async () => {
      const result = await service.createMany([]);

      expect(result).toEqual([]);
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.issueActivity.create).not.toHaveBeenCalled();
    });

    it('creates all activities inside a single transaction', async () => {
      const a1 = makeActivity('act-3', 'stateId');
      const a2 = makeActivity('act-4', 'assigneeId');
      prisma.issueActivity.create.mockResolvedValueOnce(a1).mockResolvedValueOnce(a2);

      const result = await service.createMany([
        {
          actorId: ACTOR_ID,
          field: 'stateId',
          issueId: ISSUE_ID,
          newValue: 'new',
          oldValue: 'old',
        },
        {
          actorId: ACTOR_ID,
          field: 'assigneeId',
          issueId: ISSUE_ID,
          newValue: 'new',
          oldValue: 'old',
        },
      ]);

      expect(prisma.$transaction).toHaveBeenCalledOnce();
      expect(prisma.issueActivity.create).toHaveBeenCalledTimes(2);
      expect(result).toEqual([a1, a2]);
    });
  });

  describe('findByIssueId', () => {
    it('returns activities ordered newest-first with default limit', async () => {
      const activities = [makeActivity('act-5', 'title')];
      prisma.issueActivity.findMany.mockResolvedValue(activities);

      const result = await service.findByIssueId(ISSUE_ID);

      expect(prisma.issueActivity.findMany).toHaveBeenCalledWith({
        orderBy: { createdAt: 'desc' },
        take: 100,
        where: { issueId: ISSUE_ID },
      });
      expect(result).toEqual(activities);
    });

    it('respects a custom limit', async () => {
      prisma.issueActivity.findMany.mockResolvedValue([]);

      await service.findByIssueId(ISSUE_ID, 25);

      expect(prisma.issueActivity.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 25 }),
      );
    });
  });
});
