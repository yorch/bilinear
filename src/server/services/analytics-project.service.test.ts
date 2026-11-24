import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TEST_ORG } from '../../test/fixtures';
import { createMockPrisma, type MockPrismaClient } from '../../test/prisma-mock';
import {
  AnalyticsService,
  InsightsInputError,
  type IssueVisibilityScope,
} from './analytics.service';

const ORG = TEST_ORG.id;
const scope: IssueVisibilityScope = {
  guestTeamIds: [],
  memberTeamIds: ['team-a'],
  userId: 'u1',
};
const d = (s: string) => new Date(`${s}T12:00:00Z`);

describe('AnalyticsService project/insights', () => {
  let prisma: MockPrismaClient;
  let service: AnalyticsService;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-15T12:00:00Z'));
    prisma = createMockPrisma();
    service = new AnalyticsService(prisma as never);
  });
  afterEach(() => vi.useRealTimers());

  describe('projectBurnup', () => {
    it('returns null for a project outside the org', async () => {
      prisma.project.findFirst.mockResolvedValue(null);
      expect(await service.projectBurnup(ORG, 'p1', scope)).toBeNull();
    });

    it('yields an empty series and "no issues" forecast for an empty project', async () => {
      prisma.project.findFirst.mockResolvedValue({ id: 'p1', targetDate: null });
      prisma.issue.findMany.mockResolvedValue([]);
      const r = await service.projectBurnup(ORG, 'p1', scope);
      expect(r?.points).toEqual([]);
      expect(r?.forecast).toMatchObject({ reason: 'noIssues', status: 'insufficient' });
    });

    it('a project with issues but no completions has no velocity forecast', async () => {
      prisma.project.findFirst.mockResolvedValue({ id: 'p1', targetDate: d('2026-07-01') });
      prisma.issue.findMany.mockResolvedValue(
        [1, 2].map(() => ({
          addedToProjectAt: null,
          canceledAt: null,
          completedAt: null,
          createdAt: d('2026-05-20'),
          projectId: 'p1',
        })),
      );
      const r = await service.projectBurnup(ORG, 'p1', scope);
      expect(r?.forecast).toMatchObject({ reason: 'noCompletions', status: 'insufficient' });
      expect(r?.targetDate).toBe('2026-07-01');
      expect(r?.points.at(-1)).toMatchObject({ completed: 0, date: '2026-06-15', scope: 2 });
    });

    it("queries only issues in the viewer's member teams (private-team counts do not leak)", async () => {
      prisma.project.findFirst.mockResolvedValue({ id: 'p1', targetDate: null });
      prisma.issue.findMany.mockResolvedValue([]);
      await service.projectBurnup(ORG, 'p1', { ...scope, guestTeamIds: ['team-a'] });
      const where = prisma.issue.findMany.mock.calls[0][0].where;
      expect(where.AND[0]).toEqual({ teamId: { in: ['team-a'] } });
      // guest team: creator-or-assignee restriction is applied too
      expect(JSON.stringify(where.AND[1])).toContain('"creatorId":"u1"');
      expect(where.projectId).toEqual({ in: ['p1'] });
    });

    it('a non-member of any team sees zero and never queries issues', async () => {
      prisma.project.findFirst.mockResolvedValue({ id: 'p1', targetDate: null });
      const r = await service.projectBurnup(ORG, 'p1', { ...scope, memberTeamIds: [] });
      expect(prisma.issue.findMany).not.toHaveBeenCalled();
      expect(r?.points).toEqual([]);
    });
  });

  describe('insights', () => {
    it('rejects unknown measure/slice', async () => {
      await expect(service.insights(ORG, 'u1', 'nope', 'status', scope)).rejects.toBeInstanceOf(
        InsightsInputError,
      );
      await expect(service.insights(ORG, 'u1', 'count', 'nope', scope)).rejects.toBeInstanceOf(
        InsightsInputError,
      );
    });

    it('scopes the scan to visible teams and aggregates', async () => {
      prisma.issue.findMany.mockResolvedValue([
        {
          assignee: null,
          assigneeId: null,
          completedAt: null,
          createdAt: d('2026-06-01'),
          creatorId: 'u1',
          cycleId: null,
          dueDate: null,
          estimate: 2,
          id: 'i1',
          labelAssignments: [],
          priority: 1,
          project: null,
          projectId: null,
          sortOrder: 0,
          startedAt: null,
          state: { name: 'Todo' },
          stateId: 's1',
          team: { id: 'team-a', name: 'Eng' },
          updatedAt: d('2026-06-01'),
        },
      ]);
      const r = await service.insights(ORG, 'u1', 'estimate', 'team', scope);
      expect(r.rows).toEqual([
        { issueCount: 1, key: 'team-a', label: 'Eng', sampleSize: 1, value: 2 },
      ]);
      const where = prisma.issue.findMany.mock.calls[0][0].where;
      expect(where.AND[0]).toEqual({ teamId: { in: ['team-a'] } });
      expect(where.organizationId).toBe(ORG);
    });

    it("applies a saved view's filters, and only views the caller can see", async () => {
      prisma.customView.findFirst.mockResolvedValue({
        filters: {
          composition: 'and',
          conditions: [{ field: 'priority', operator: 'eq', value: 1 }],
        },
        teamId: null,
      });
      const row = (id: string, priority: number) => ({
        assignee: null,
        assigneeId: null,
        completedAt: null,
        createdAt: d('2026-06-01'),
        creatorId: 'u1',
        cycleId: null,
        dueDate: null,
        estimate: null,
        id,
        labelAssignments: [],
        priority,
        project: null,
        projectId: null,
        sortOrder: 0,
        startedAt: null,
        state: { name: 'Todo' },
        stateId: 's1',
        team: { id: 'team-a', name: 'Eng' },
        updatedAt: d('2026-06-01'),
      });
      prisma.issue.findMany.mockResolvedValue([row('a', 1), row('b', 2)]);
      const r = await service.insights(ORG, 'u1', 'count', 'priority', scope, 'v1');
      expect(r.issueCount).toBe(1);
      const viewWhere = prisma.customView.findFirst.mock.calls[0][0].where;
      expect(viewWhere.OR).toEqual([{ creatorId: 'u1' }, { shared: true }]);
      expect(viewWhere.organizationId).toBe(ORG);
    });

    it('an unreachable view is an input error, not an unfiltered result', async () => {
      prisma.customView.findFirst.mockResolvedValue(null);
      await expect(
        service.insights(ORG, 'u1', 'count', 'status', scope, 'v9'),
      ).rejects.toBeInstanceOf(InsightsInputError);
    });

    it('returns nothing without querying when the viewer is in no team', async () => {
      const r = await service.insights(ORG, 'u1', 'count', 'status', {
        ...scope,
        memberTeamIds: [],
      });
      expect(prisma.issue.findMany).not.toHaveBeenCalled();
      expect(r.rows).toEqual([]);
    });
  });

  describe('initiativeHealthRollups', () => {
    it('keeps the manual initiative update beside the derived value, never merged', async () => {
      prisma.initiative.findMany.mockResolvedValue([
        {
          id: 'i1',
          projects: [
            {
              project: {
                archivedAt: null,
                health: 'offTrack',
                healthUpdatedAt: d('2026-06-01'),
                id: 'p1',
                statusType: 'inProgress',
                targetDate: null,
              },
            },
          ],
          targetDate: null,
        },
      ]);
      prisma.issue.findMany.mockResolvedValue([]);
      prisma.projectUpdate.findMany.mockResolvedValue([]);
      prisma.initiativeUpdate.findMany.mockResolvedValue([
        { health: 'onTrack', initiativeId: 'i1' },
      ]);
      const [r] = await service.initiativeHealthRollups(ORG, scope);
      expect(r.health).toBe('offTrack'); // derived
      expect(r.manualHealth).toBe('onTrack'); // manual, untouched
    });

    it('prefers a newer project update over an older project health field', async () => {
      prisma.initiative.findMany.mockResolvedValue([
        {
          id: 'i1',
          projects: [
            {
              project: {
                archivedAt: null,
                health: 'offTrack',
                healthUpdatedAt: d('2026-05-01'),
                id: 'p1',
                statusType: 'inProgress',
                targetDate: null,
              },
            },
          ],
          targetDate: null,
        },
      ]);
      prisma.issue.findMany.mockResolvedValue([]);
      prisma.projectUpdate.findMany.mockResolvedValue([
        { createdAt: d('2026-06-10'), health: 'onTrack', projectId: 'p1' },
      ]);
      prisma.initiativeUpdate.findMany.mockResolvedValue([]);
      const [r] = await service.initiativeHealthRollups(ORG, scope);
      expect(r.health).toBe('onTrack');
    });
  });
});
