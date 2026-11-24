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
      expect(t).toMatch(/^[\p{L}\p{N}\p{M}]+$/u);
    }
  });

  it('keeps accented and non-Latin words whole instead of cutting at the first non-ASCII letter', () => {
    expect(extractQueryTerms('Error al iniciar sesión')).toEqual(['error', 'iniciar', 'sesión']);
    expect(extractQueryTerms('El botón de exportación')).toEqual(['botón', 'exportación']);
    expect(extractQueryTerms('Die Größe der Straße')).toEqual(['die', 'größe', 'der', 'straße']);
    expect(extractQueryTerms('导出失败 报告')).toEqual(['导出失败', '报告']);
    // Decomposed (NFD) input is normalised, not split at the combining mark.
    expect(extractQueryTerms('sesio\u0301n')).toEqual(['sesión']);
  });

  it('keeps two-character all-caps acronyms but not ordinary short words', () => {
    expect(extractQueryTerms('CI broken, UI is an eyesore')).toEqual([
      'ci',
      'broken',
      'ui',
      'eyesore',
    ]);
    expect(extractQueryTerms('is an of 42')).toEqual([]);
  });

  it('drops short terms, dedupes and caps the term count', () => {
    expect(extractQueryTerms('a an Login login LOGIN')).toEqual(['login']);
    expect(extractQueryTerms('x yz')).toEqual([]);
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
    // Terms travel as a bound array and are re-parsed by plainto_tsquery in SQL;
    // no user text is ever concatenated into a tsquery string.
    expect(values).toContainEqual(['crash', 'login']);
    expect(values).toContain(3);
    expect(sql).toContain("plainto_tsquery('english', t.term)");
    expect(sql).not.toMatch(/(?<!plain)to_tsquery\(/);
    expect(values).toContainEqual(['team-a']);
    expect(values).toContain('src');
    expect(sql).toContain('archived_at IS NULL');
    expect(sql).toContain('trashed = false');
    // Triage peers are candidates; declined (canceled, no duplicate relation) are not.
    expect(sql).not.toContain("'triage'");
    expect(sql).toContain("ws.type::text != 'canceled'");
    expect(sql).toContain("r.type = 'duplicate'");
    // Stop words are dropped before the threshold is derived; the threshold is
    // enforced by the index gate (pairs) rather than a post-filter.
    expect(sql).toContain('numnode(tq) > 0');
    expect(sql).toContain('count(*) >= 3');
    expect(sql).toContain('MATERIALIZED');
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
    state: { type: 'backlog' },
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

  it('flags triage peers and strips the joined state from the issue', async () => {
    const { service } = setup(
      [{ issueId: 'peer', score: 0.9 }],
      [row('peer', { state: { type: 'triage' } })],
    );
    const [hit] = await service.suggest(TEST_ORG.id, 'src', SCOPE);
    expect(hit.inTriage).toBe(true);
    expect(hit.issue).not.toHaveProperty('state');
  });

  it('follows a canceled duplicate to its canonical issue and never offers a declined one', async () => {
    const { prisma, service } = setup(
      [
        { issueId: 'dup', score: 0.9 },
        { issueId: 'declined', score: 0.8 },
        { issueId: 'canon', score: 0.7 },
      ],
      [
        row('dup', { state: { type: 'canceled' } }),
        row('declined', { state: { type: 'canceled' } }),
        row('canon'),
      ],
    );
    prisma.issueRelation.findFirst.mockImplementation(
      async (args: { where: { issueId: string } }) =>
        args.where.issueId === 'dup' ? { relatedIssueId: 'canon' } : null,
    );
    prisma.issue.findFirst.mockImplementation(async (args: { where: { id: string } }) =>
      args.where.id === 'canon' ? row('canon') : SOURCE,
    );
    const out = await service.suggest(TEST_ORG.id, 'src', SCOPE);
    // 'dup' resolves to 'canon' (kept once, at the better score); 'declined' is dropped.
    expect(out.map(r => r.issue.id)).toEqual(['canon']);
    expect(out[0].score).toBe(0.9);
  });

  it('stops at a canonical that is itself canceled, and never suggests the source', async () => {
    const { prisma, service } = setup(
      [{ issueId: 'dup', score: 0.9 }],
      [row('dup', { state: { type: 'canceled' } })],
    );
    prisma.issueRelation.findFirst.mockResolvedValue({ relatedIssueId: 'src' });
    prisma.issue.findFirst.mockImplementation(async (args: { where: { id: string } }) =>
      args.where.id === 'src' ? row('src') : SOURCE,
    );
    expect(await service.suggest(TEST_ORG.id, 'src', SCOPE)).toEqual([]);
  });

  it('applies visibility when following a duplicate link', async () => {
    const { prisma, service } = setup(
      [{ issueId: 'dup', score: 0.9 }],
      [row('dup', { state: { type: 'canceled' } })],
    );
    prisma.issueRelation.findFirst.mockResolvedValue({ relatedIssueId: 'hidden' });
    prisma.issue.findFirst.mockImplementation(async (args: { where: Record<string, unknown> }) =>
      args.where.id === 'hidden' ? null : SOURCE,
    );
    expect(await service.suggest(TEST_ORG.id, 'src', SCOPE)).toEqual([]);
    const lookup = prisma.issue.findFirst.mock.calls.find(
      c => (c[0] as { where: { id: string } }).where.id === 'hidden',
    );
    expect(lookup?.[0].where).toMatchObject({
      archivedAt: null,
      organizationId: TEST_ORG.id,
      teamId: { in: ['team-a'] },
      trashed: false,
    });
  });
});
