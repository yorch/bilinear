/**
 * S2-B: fail-closed filtering of unscoped rows, per-creator custom views, and
 * redaction of a private origin team after a move.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Prisma } from '../../generated/prisma';
import { TEST_ORG } from '../../test/fixtures';
import { createMockPrisma, type MockPrismaClient } from '../../test/prisma-mock';
import {
  dropForeignUserRows,
  ISSUE_BOUND_MODELS,
  parseCursor,
  SyncService,
  TEAM_BOUND_MODELS,
} from './sync.service';

const mockRedis = { publish: vi.fn().mockResolvedValue(1) } as unknown as ConstructorParameters<
  typeof SyncService
>[1];

const HIDDEN = 'team-hidden';
const OPEN = 'team-open';
const GUEST_TEAM = 'team-guest';
const VIEWER = 'viewer';
const scope = { guestTeamIds: [GUEST_TEAM], hiddenTeamIds: [HIDDEN], userId: VIEWER };

let n = 0;
function row(modelName: string, data: Record<string, unknown> | null, extra = {}) {
  n += 1;
  return {
    action: 'U' as const,
    createdAt: new Date(),
    data: data as Prisma.JsonValue,
    id: BigInt(n),
    modelId: (data?.id as string) ?? `m${n}`,
    modelName,
    organizationId: TEST_ORG.id,
    xactId: BigInt(100 + n),
    ...extra,
  };
}

describe('filterVisibleActions fails closed', () => {
  let prisma: MockPrismaClient;
  let svc: SyncService;
  beforeEach(() => {
    prisma = createMockPrisma();
    svc = new SyncService(prisma as never, mockRedis);
    prisma.issue.findMany.mockResolvedValue([]);
    prisma.team.findMany.mockResolvedValue([]);
  });

  it('a partial Issue payload (custom field values only) follows the live issue visibility', async () => {
    prisma.issue.findMany.mockResolvedValue([
      { assigneeId: null, creatorId: 'x', id: 'i-private', teamId: HIDDEN },
      { assigneeId: null, creatorId: 'x', id: 'i-open', teamId: OPEN },
      { assigneeId: VIEWER, creatorId: 'x', id: 'i-guest-own', teamId: GUEST_TEAM },
      { assigneeId: null, creatorId: 'x', id: 'i-guest-other', teamId: GUEST_TEAM },
    ]);
    const mk = (id: string) =>
      row('Issue', { customFieldValues: [{ value: 'S2SECRET' }] }, { modelId: id });
    const out = await svc.filterVisibleActions(
      [mk('i-private'), mk('i-open'), mk('i-guest-own'), mk('i-guest-other'), mk('i-gone')],
      scope,
    );
    expect(out.map(r => r.modelId)).toEqual(['i-open', 'i-guest-own']);
  });

  it.each([...ISSUE_BOUND_MODELS])('drops an unscoped %s row (no issueId, no teamId)', async m => {
    const out = await svc.filterVisibleActions([row(m, { id: 'x', note: 'secret' })], scope);
    expect(out).toEqual([]);
  });

  it.each([...TEAM_BOUND_MODELS])('drops an unscoped %s row (no teamId)', async m => {
    const out = await svc.filterVisibleActions([row(m, { id: 'x', name: 'secret' })], scope);
    expect(out).toEqual([]);
  });

  it('still passes deletes and correctly scoped rows', async () => {
    prisma.issue.findMany.mockResolvedValue([
      { assigneeId: null, creatorId: 'x', id: 'i-open', teamId: OPEN },
    ]);
    const out = await svc.filterVisibleActions(
      [
        row('Comment', null, { action: 'D' }),
        row('CommentReaction', { id: 'r', issueId: 'i-open' }),
        row('Cycle', { id: 'c', teamId: OPEN }),
      ],
      scope,
    );
    expect(out).toHaveLength(3);
  });
});

describe('per-creator custom views', () => {
  const view = (action: 'I' | 'U' | 'A', shared: boolean, creatorId: string) =>
    row('CustomView', { creatorId, id: 'v1', name: 'N', shared }, { action });

  it('drops an INSERT of someone else’s unshared view', () => {
    expect(dropForeignUserRows([view('I', false, 'other')], VIEWER)).toEqual([]);
  });

  it('turns an update of someone else’s unshared view into a delete (shared -> unshared)', () => {
    const [out] = dropForeignUserRows([view('U', false, 'other')], VIEWER);
    expect(out.action).toBe('D');
    expect(out.data).toBeNull();
    const [archived] = dropForeignUserRows([view('A', false, 'other')], VIEWER);
    expect(archived.action).toBe('D');
  });

  it('passes a shared view and the creator’s own unshared view; unshared -> shared arrives as an insert', () => {
    const rows = [view('I', true, 'other'), view('U', false, VIEWER), view('U', true, 'other')];
    expect(dropForeignUserRows(rows, VIEWER)).toEqual(rows);
  });

  it('bootstrap only returns shared views or the viewer’s own', async () => {
    const prisma = createMockPrisma();
    const svc = new SyncService(prisma as never, mockRedis);
    prisma.organization.findUnique.mockResolvedValue(null);
    for (const m of [
      'team',
      'user',
      'issue',
      'workflowState',
      'issueLabel',
      'issueLabelAssignment',
      'cycle',
      'document',
      'project',
      'projectMilestone',
      'customView',
      'issueRelation',
      'issueTemplate',
      'customFieldDefinition',
      'customFieldValue',
      'initiative',
      'initiativeProject',
      'issueReminder',
    ] as const) {
      prisma[m].findMany.mockResolvedValue([]);
    }
    prisma.$queryRaw.mockResolvedValue([{ id: BigInt(1), xactId: '10' }]);
    for (const s of [{ ...scope, guestTeamIds: [], hiddenTeamIds: [] }, scope]) {
      prisma.customView.findMany.mockClear();
      await svc.getBootstrapData(TEST_ORG.id, s);
      const where = (
        prisma.customView.findMany.mock.calls[0] as [{ where: Record<string, unknown> }]
      )[0].where;
      expect(where.AND).toEqual([{ OR: [{ shared: true }, { creatorId: VIEWER }] }]);
    }
  });
});

describe('origin team redaction after a private -> public move', () => {
  let prisma: MockPrismaClient;
  let svc: SyncService;
  beforeEach(() => {
    prisma = createMockPrisma();
    svc = new SyncService(prisma as never, mockRedis);
    prisma.issue.findMany.mockResolvedValue([]);
    teamKeys(prisma);
  });

  const move = () =>
    row('Issue', {
      creatorId: 'x',
      id: 'i1',
      identifier: 'ENG-7',
      movedFromTeamId: HIDDEN,
      previousIdentifiers: ['SEC-12', 'OLD-3'],
      teamId: OPEN,
    });

  it('strips movedFromTeamId and the private key from a viewer outside the origin team', async () => {
    const [out] = await svc.filterVisibleActions([move()], scope);
    const data = out.data as Record<string, unknown>;
    expect(data).not.toHaveProperty('movedFromTeamId');
    expect(data.previousIdentifiers).toEqual(['OLD-3']);
    const text = JSON.stringify(out.data);
    expect(text).not.toContain('SEC');
    expect(text).not.toContain(HIDDEN);
  });

  it('leaves the row intact for a member of the origin team', async () => {
    const member = { guestTeamIds: [GUEST_TEAM], hiddenTeamIds: ['other-hidden'], userId: VIEWER };
    const original = move();
    const [out] = await svc.filterVisibleActions([original], member);
    expect(out).toBe(original);
  });

  it('bootstrap strips previousIdentifiers that carry a hidden team key', async () => {
    mockBootstrap(prisma, [
      { id: 'i1', identifier: 'ENG-7', previousIdentifiers: ['SEC-12', 'OLD-3'], teamId: OPEN },
    ]);
    const data = await svc.getBootstrapData(TEST_ORG.id, scope);
    expect(data.issues[0].previousIdentifiers).toEqual(['OLD-3']);
    const members = await svc.getBootstrapData(TEST_ORG.id, { ...scope, hiddenTeamIds: [] });
    expect(members.issues[0].previousIdentifiers).toEqual(['SEC-12', 'OLD-3']);
  });
});

/** `team.findMany`: the key lookup answers for the ids asked about, the roster is empty. */
function teamKeys(prisma: MockPrismaClient) {
  prisma.team.findMany.mockImplementation((async (args: {
    select?: { key?: boolean };
    where?: { id?: { in?: string[] } };
  }) =>
    args?.select?.key && args.where?.id?.in?.includes(HIDDEN) ? [{ key: 'SEC' }] : []) as never);
}

function mockBootstrap(prisma: MockPrismaClient, issues: unknown[]) {
  prisma.organization.findUnique.mockResolvedValue(null);
  for (const m of [
    'team',
    'user',
    'workflowState',
    'issueLabel',
    'issueLabelAssignment',
    'cycle',
    'document',
    'project',
    'projectMilestone',
    'customView',
    'issueRelation',
    'issueTemplate',
    'customFieldDefinition',
    'customFieldValue',
    'initiative',
    'initiativeProject',
    'issueReminder',
  ] as const) {
    prisma[m].findMany.mockResolvedValue([]);
  }
  teamKeys(prisma);
  prisma.issue.findMany.mockResolvedValue(issues);
  prisma.$queryRaw.mockResolvedValue([{ id: BigInt(1), xactId: '10' }]);
}

void parseCursor;
