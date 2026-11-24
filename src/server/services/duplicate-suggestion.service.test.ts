import { describe, expect, it, vi } from 'vitest';
import { TEST_ISSUE, TEST_ORG } from '../../test/fixtures';
import { createMockPrisma } from '../../test/prisma-mock';
import {
  type DuplicateScorer,
  DuplicateSourceNotFoundError,
  DuplicateSuggestionService,
  extractQueryTerms,
  FtsDuplicateScorer,
  MAX_DUPLICATE_SUGGESTIONS,
} from './duplicate-suggestion.service';

const SCOPE = { guestTeamIds: [], memberTeamIds: ['team-a'], userId: 'user-1' };
const SOURCE = { description: null, id: 'src', teamId: 'team-a', title: 'Login page crashes' };

function sqlOf(call: unknown): { sql: string; values: unknown[] } {
  const q = call as { sql: string; values: unknown[] };
  return { sql: q.sql, values: q.values };
}

describe('extractQueryTerms', () => {
  it('strips tsquery operators so user text can never inject syntax', () => {
    const terms = extractQueryTerms("foo' & !bar | (baz:*) <-> qux; DROP TABLE issues");
    expect(terms).toEqual(['foo', 'bar', 'baz', 'qux', 'drop', 'table', 'issues']);
    for (const t of terms) {
      expect(t).toMatch(/^[a-z0-9]+$/);
    }
  });

  it('drops short terms, dedupes and caps the term count', () => {
    expect(extractQueryTerms('a an Login login LOGIN')).toEqual(['login']);
    const many = Array.from({ length: 40 }, (_, i) => `word${i}`).join(' ');
    expect(extractQueryTerms(many)).toHaveLength(12);
  });
});

describe('FtsDuplicateScorer', () => {
  it('builds an OR tsquery from sanitised terms and scopes by team and state', async () => {
    const prisma = createMockPrisma();
    prisma.$queryRaw.mockResolvedValue([{ id: 'x', matched: ['crash'], score: 0.4 }]);
    const out = await new FtsDuplicateScorer(prisma as never).score({
      limit: 3,
      orgId: TEST_ORG.id,
      scope: SCOPE,
      source: { ...SOURCE, title: "crash' | !(x) & login" },
    });
    expect(out).toEqual([{ issueId: 'x', matchedTerms: ['crash'], score: 0.4 }]);
    const { sql, values } = sqlOf(prisma.$queryRaw.mock.calls[0][0]);
    expect(values).toContain('crash | login');
    expect(values).toContainEqual(['crash', 'login']);
    expect(values).toContain(1);
    expect(values).toContainEqual(['team-a']);
    expect(values).toContain('src');
    expect(sql).toContain('archived_at IS NULL');
    expect(sql).toContain('trashed = false');
    expect(sql).toContain("ws.type::text != 'triage'");
    expect(sql).toContain('i.id !=');
  });

  it('adds the guest restriction only when the caller is a guest somewhere', async () => {
    const prisma = createMockPrisma();
    prisma.$queryRaw.mockResolvedValue([]);
    const scorer = new FtsDuplicateScorer(prisma as never);
    await scorer.score({ limit: 3, orgId: 'o', scope: SCOPE, source: SOURCE });
    await scorer.score({
      limit: 3,
      orgId: 'o',
      scope: { ...SCOPE, guestTeamIds: ['team-a'] },
      source: SOURCE,
    });
    expect(sqlOf(prisma.$queryRaw.mock.calls[0][0]).sql).not.toContain('creator_id');
    expect(sqlOf(prisma.$queryRaw.mock.calls[1][0]).sql).toContain('creator_id');
  });

  it('never queries with no visible teams or no usable terms', async () => {
    const prisma = createMockPrisma();
    const scorer = new FtsDuplicateScorer(prisma as never);
    expect(
      await scorer.score({
        limit: 3,
        orgId: 'o',
        scope: { ...SCOPE, memberTeamIds: [] },
        source: SOURCE,
      }),
    ).toEqual([]);
    expect(
      await scorer.score({
        limit: 3,
        orgId: 'o',
        scope: SCOPE,
        source: { ...SOURCE, title: '!! ?? a' },
      }),
    ).toEqual([]);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });
});

describe('DuplicateSuggestionService', () => {
  function setup(scored: Array<{ issueId: string; score: number }>, rows: unknown[]) {
    const prisma = createMockPrisma();
    prisma.issue.findFirst.mockResolvedValue(SOURCE);
    prisma.issue.findMany.mockResolvedValue(rows);
    const scorer: DuplicateScorer = { score: vi.fn().mockResolvedValue(scored) };
    return { prisma, scorer, service: new DuplicateSuggestionService(prisma as never, scorer) };
  }
  const row = (id: string, extra: Record<string, unknown> = {}) => ({
    ...TEST_ISSUE,
    id,
    teamId: 'team-a',
    title: `Login ${id}`,
    ...extra,
  });

  it('throws when the source issue is not in the org', async () => {
    const { prisma, service } = setup([], []);
    prisma.issue.findFirst.mockResolvedValue(null);
    await expect(service.suggest(TEST_ORG.id, 'nope', SCOPE)).rejects.toBeInstanceOf(
      DuplicateSourceNotFoundError,
    );
  });

  it('caps the requested size at the hard maximum', async () => {
    const { scorer, service } = setup([], []);
    await service.suggest(TEST_ORG.id, 'src', SCOPE, 500);
    expect(scorer.score).toHaveBeenCalledWith(
      expect.objectContaining({ limit: MAX_DUPLICATE_SUGGESTIONS }),
    );
  });

  it('returns nothing and skips the scorer for first <= 0', async () => {
    const { scorer, service } = setup([], []);
    expect(await service.suggest(TEST_ORG.id, 'src', SCOPE, 0)).toEqual([]);
    expect(scorer.score).not.toHaveBeenCalled();
  });

  it('hydrates in score order, reports matched terms and re-asserts exclusions', async () => {
    const { prisma, service } = setup(
      [
        { issueId: 'b', score: 0.9 },
        { issueId: 'a', score: 0.5 },
        { issueId: 'gone', score: 0.4 },
      ],
      [row('a'), row('b')],
    );
    const out = await service.suggest(TEST_ORG.id, 'src', SCOPE);
    expect(out.map(r => r.issue.id)).toEqual(['b', 'a']);
    expect(out[0].matchedTerms).toEqual(['login']);
    const where = prisma.issue.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({
      archivedAt: null,
      id: { in: ['b', 'a', 'gone'], not: 'src' },
      organizationId: TEST_ORG.id,
      state: { type: { not: 'triage' } },
      teamId: { in: ['team-a'] },
      trashed: false,
    });
  });

  it('drops a guest-team row the guest neither created nor is assigned to', async () => {
    const { service } = setup(
      [
        { issueId: 'mine', score: 0.9 },
        { issueId: 'other', score: 0.8 },
      ],
      [row('mine', { creatorId: 'user-1' }), row('other', { assigneeId: null, creatorId: 'u2' })],
    );
    const out = await service.suggest(TEST_ORG.id, 'src', { ...SCOPE, guestTeamIds: ['team-a'] });
    expect(out.map(r => r.issue.id)).toEqual(['mine']);
  });
});
