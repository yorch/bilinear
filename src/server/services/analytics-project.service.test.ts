import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TEST_ORG } from '../../test/fixtures';
import { createMockPrisma, type MockPrismaClient } from '../../test/prisma-mock';
import {
  AnalyticsService,
  INSIGHTS_CACHE_TTL_MS,
  INSIGHTS_SCAN_LIMIT,
  InsightsInputError,
  type IssueVisibilityScope,
} from './analytics.service';

const ORG = TEST_ORG.id;
const scope: IssueVisibilityScope = {
  guestTeamIds: [],
  hiddenTeamIds: [],
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
    for (const m of [
      prisma.workflowState,
      prisma.user,
      prisma.issueLabel,
      prisma.project,
      prisma.team,
    ]) {
      m.findMany.mockResolvedValue([]);
    }
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

    it('never counts trashed or archived issues', async () => {
      prisma.project.findFirst.mockResolvedValue({ id: 'p1', targetDate: null });
      prisma.issue.findMany.mockResolvedValue([]);
      await service.projectBurnup(ORG, 'p1', scope);
      expect(prisma.issue.findMany.mock.calls[0][0].where).toMatchObject({
        archivedAt: null,
        organizationId: ORG,
        trashed: false,
      });
    });

    it('hides ONLY private teams the viewer is not in; a non-member of a PUBLIC team still sees it', async () => {
      prisma.project.findFirst.mockResolvedValue({ id: 'p1', targetDate: null });
      prisma.issue.findMany.mockResolvedValue([]);
      // sofia: not a member of public OPS (so it is NOT in hiddenTeamIds), not in private HR.
      await service.projectBurnup(ORG, 'p1', { ...scope, hiddenTeamIds: ['team-private'] });
      const where = prisma.issue.findMany.mock.calls[0][0].where;
      expect(where.AND).toEqual([{ teamId: { notIn: ['team-private'] } }]);
      // there is no "member teams only" clause that would drop a public team
      expect(JSON.stringify(where)).not.toContain('"in":["team-a"]');
      expect(where.projectId).toEqual({ in: ['p1'] });
    });

    it('applies no team restriction at all when nothing is hidden', async () => {
      prisma.project.findFirst.mockResolvedValue({ id: 'p1', targetDate: null });
      prisma.issue.findMany.mockResolvedValue([]);
      await service.projectBurnup(ORG, 'p1', scope);
      expect(prisma.issue.findMany.mock.calls[0][0].where.AND).toBeUndefined();
    });

    it('guest teams keep the creator-or-assignee restriction', async () => {
      prisma.project.findFirst.mockResolvedValue({ id: 'p1', targetDate: null });
      prisma.issue.findMany.mockResolvedValue([]);
      await service.projectBurnup(ORG, 'p1', { ...scope, guestTeamIds: ['team-a'] });
      const where = prisma.issue.findMany.mock.calls[0][0].where;
      expect(JSON.stringify(where.AND)).toContain('"creatorId":"u1"');
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

    const U1 = '11111111-1111-4111-8111-111111111111';
    const row = (over: Record<string, unknown> = {}) => ({
      assigneeId: null,
      completedAt: null,
      estimate: null,
      priority: 1,
      projectId: null,
      startedAt: null,
      stateId: 's1',
      teamId: 'team-a',
      ...over,
    });

    it('aggregates with names resolved only for the slice, and reads scalar columns only', async () => {
      prisma.issue.findMany.mockResolvedValue([row({ estimate: 2 })]);
      prisma.team.findMany.mockResolvedValue([{ id: 'team-a', name: 'Eng' }]);
      const r = await service.insights(ORG, 'u1', 'estimate', 'team', scope);
      expect(r.rows).toEqual([
        { issueCount: 1, key: 'team-a', label: 'Eng', sampleSize: 1, value: 2 },
      ]);
      const args = prisma.issue.findMany.mock.calls[0][0];
      expect(args.select.assignee).toBeUndefined();
      expect(args.select.labelAssignments).toBeUndefined();
      expect(args.take).toBe(20_001);
      expect(prisma.workflowState.findMany).not.toHaveBeenCalled();
    });

    it('a non-member of a PUBLIC team still counts its issues; a hidden private team is excluded', async () => {
      prisma.issue.findMany.mockResolvedValue([]);
      await service.insights(ORG, 'u1', 'count', 'status', { ...scope, hiddenTeamIds: ['priv'] });
      const where = prisma.issue.findMany.mock.calls[0][0].where;
      expect(JSON.stringify(where)).toContain('"teamId":{"notIn":["priv"]}');
      expect(where.AND.at(-1).organizationId).toBe(ORG);
      expect(where.AND.at(-1).trashed).toBe(false);
      expect(where.AND.at(-1).archivedAt).toBeNull();
    });

    it('with nothing hidden the scan has no team restriction (sofia vs a public team)', async () => {
      prisma.issue.findMany.mockResolvedValue([]);
      await service.insights(ORG, 'u1', 'count', 'status', scope);
      expect(JSON.stringify(prisma.issue.findMany.mock.calls[0][0].where)).not.toContain('teamId');
    });

    it("pushes a saved view's filters into the database where (before the scan cap)", async () => {
      prisma.customView.findFirst.mockResolvedValue({
        filters: {
          composition: 'and',
          conditions: [{ field: 'priority', operator: 'eq', value: 1 }],
        },
        teamId: 'team-v',
      });
      prisma.issue.findMany.mockResolvedValue([row()]);
      const r = await service.insights(ORG, 'u1', 'count', 'priority', scope, 'v1');
      expect(r.issueCount).toBe(1);
      const where = prisma.issue.findMany.mock.calls[0][0].where;
      expect(JSON.stringify(where)).toContain('{"OR":[{"priority":{"in":[1]}}]}');
      expect(where.AND.at(-1).teamId).toBe('team-v'); // the view's team narrowing
      const viewWhere = prisma.customView.findFirst.mock.calls[0][0].where;
      expect(viewWhere.OR).toEqual([{ creatorId: 'u1' }, { shared: true }]);
      expect(viewWhere.organizationId).toBe(ORG);
    });

    it('reports scanCapped only when MORE than the limit matched, and aggregates exactly the limit', async () => {
      prisma.issue.findMany.mockResolvedValue(
        Array.from({ length: INSIGHTS_SCAN_LIMIT + 1 }, () => row()),
      );
      const capped = await service.insights(ORG, 'u1', 'count', 'priority', scope);
      expect(capped.scanCapped).toBe(true);
      expect(capped.issueCount).toBe(INSIGHTS_SCAN_LIMIT);

      prisma.issue.findMany.mockResolvedValue(
        Array.from({ length: INSIGHTS_SCAN_LIMIT }, () => row()),
      );
      const exact = await service.insights(ORG, 'u1', 'count', 'status', scope);
      expect(exact.scanCapped).toBe(false);
      expect(exact.issueCount).toBe(INSIGHTS_SCAN_LIMIT);
    });

    it.each([
      [{ composition: 'and', conditions: [null] }],
      [{ conditions: [{ field: 'nope', operator: 'eq', value: 1 }] }],
      [{ conditions: [{ field: 'priority', operator: 'eq', value: { a: 1 } }] }],
      [{ conditions: Array.from({ length: 60 }, () => ({ field: 'priority', operator: 'eq' })) }],
      [{ conditions: [{ field: 'status', operator: 'nin', value: Array(500).fill(U1) }] }],
    ])('a malformed stored view filter is dropped, never a crash (%#)', async filters => {
      prisma.customView.findFirst.mockResolvedValue({ filters, teamId: null });
      prisma.issue.findMany.mockResolvedValue([]);
      await expect(
        service.insights(ORG, 'u1', 'count', 'status', scope, 'v1'),
      ).resolves.toBeDefined();
    });

    it('keeps the sound conditions of a partly-malformed stored view filter', async () => {
      prisma.customView.findFirst.mockResolvedValue({
        filters: {
          conditions: [
            { field: 'priority', operator: 'in', value: [1] },
            { field: 'nope', operator: 'eq', value: 1 },
          ],
        },
        teamId: null,
      });
      prisma.issue.findMany.mockResolvedValue([]);
      await service.insights(ORG, 'u1', 'count', 'status', scope, 'v1');
      const where = prisma.issue.findMany.mock.calls[0][0].where;
      expect(JSON.stringify(where)).toContain('{"priority":{"in":[1]}}');
    });

    it('a stored view filter that is not an object is an input error', async () => {
      prisma.customView.findFirst.mockResolvedValue({ filters: 'garbage', teamId: null });
      await expect(
        service.insights(ORG, 'u1', 'count', 'status', scope, 'v1'),
      ).rejects.toBeInstanceOf(InsightsInputError);
      expect(prisma.issue.findMany).not.toHaveBeenCalled();
    });

    it('custom-field conditions are refused rather than silently ignored', async () => {
      prisma.customView.findFirst.mockResolvedValue({
        filters: {
          conditions: [{ customFieldId: 'f', field: 'custom', operator: 'eq', value: 'x' }],
        },
        teamId: null,
      });
      await expect(
        service.insights(ORG, 'u1', 'count', 'status', scope, 'v1'),
      ).rejects.toBeInstanceOf(InsightsInputError);
    });

    it('an unreachable view is an input error, not an unfiltered result', async () => {
      prisma.customView.findFirst.mockResolvedValue(null);
      await expect(
        service.insights(ORG, 'u1', 'count', 'status', scope, 'v9'),
      ).rejects.toBeInstanceOf(InsightsInputError);
    });

    it('serves an identical call from the short cache, and per viewer', async () => {
      prisma.issue.findMany.mockResolvedValue([]);
      await service.insights(ORG, 'u1', 'count', 'status', scope);
      await service.insights(ORG, 'u1', 'count', 'status', scope);
      expect(prisma.issue.findMany).toHaveBeenCalledTimes(1);
      await service.insights(ORG, 'u1', 'count', 'status', { ...scope, hiddenTeamIds: ['x'] });
      expect(prisma.issue.findMany).toHaveBeenCalledTimes(2);
      await service.insights(ORG, 'u2', 'count', 'status', { ...scope, userId: 'u2' });
      expect(prisma.issue.findMany).toHaveBeenCalledTimes(3);
      await service.insights(ORG, 'u1', 'count', 'status', scope);
      expect(prisma.issue.findMany).toHaveBeenCalledTimes(3);
      vi.advanceTimersByTime(INSIGHTS_CACHE_TTL_MS + 1);
      await service.insights(ORG, 'u1', 'count', 'status', scope);
      expect(prisma.issue.findMany).toHaveBeenCalledTimes(4);
    });

    it('does not cache a failed scan', async () => {
      prisma.issue.findMany.mockRejectedValueOnce(new Error('db down'));
      await expect(service.insights(ORG, 'u1', 'count', 'status', scope)).rejects.toThrow();
      prisma.issue.findMany.mockResolvedValue([]);
      await expect(service.insights(ORG, 'u1', 'count', 'status', scope)).resolves.toBeDefined();
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
