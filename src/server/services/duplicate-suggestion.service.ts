import type { Issue, PrismaClient } from '../../generated/prisma';
import { Prisma } from '../../generated/prisma';
import type { SearchVisibilityScope } from './search.service';

/** Hard ceiling on suggestions, whatever the caller asks for. */
export const MAX_DUPLICATE_SUGGESTIONS = 5;
export const DEFAULT_DUPLICATE_SUGGESTIONS = 3;
/** Query terms handed to Postgres; a long title must not become a long tsquery. */
const MAX_TERMS = 12;
const MIN_TERM_LENGTH = 3;

export class DuplicateSourceNotFoundError extends Error {
  constructor() {
    super('Issue not found');
    this.name = 'DuplicateSourceNotFoundError';
  }
}

export interface DuplicateSource {
  description: string | null;
  id: string;
  teamId: string;
  title: string;
}

export interface ScoredCandidate {
  issueId: string;
  /** Source terms this candidate matched, if the scorer knows (stem-aware). */
  matchedTerms?: string[];
  /** Higher is more similar. Scale is scorer-defined; only the order is relied on. */
  score: number;
}

export interface DuplicateScoreRequest {
  limit: number;
  orgId: string;
  scope: SearchVisibilityScope;
  source: DuplicateSource;
}

/**
 * Pluggable similarity strategy. The FTS scorer below is the default; an
 * embedding/AI scorer can replace it by implementing this one method. A scorer
 * is responsible for honouring `scope` (visibility) and for excluding the
 * source issue, archived/trashed issues and issues still in triage — the
 * service re-verifies visibility on hydration but does not re-rank.
 */
export interface DuplicateScorer {
  score(request: DuplicateScoreRequest): Promise<ScoredCandidate[]>;
}

export interface DuplicateSuggestionResult {
  issue: Issue;
  matchedTerms: string[];
  score: number;
}

/**
 * Reduce free text to safe tsquery lexemes. Only `[a-z0-9]` runs survive, so
 * no tsquery operator (`& | ! <-> ( ) : * '`) can ever reach `to_tsquery` — the
 * query is built by this function, never by the caller's text.
 */
export function extractQueryTerms(text: string): string[] {
  const seen = new Set<string>();
  for (const raw of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length >= MIN_TERM_LENGTH && !seen.has(raw)) {
      seen.add(raw);
      if (seen.size >= MAX_TERMS) {
        break;
      }
    }
  }
  return [...seen];
}

export class FtsDuplicateScorer implements DuplicateScorer {
  constructor(private prisma: PrismaClient) {}

  async score({ limit, orgId, scope, source }: DuplicateScoreRequest): Promise<ScoredCandidate[]> {
    const terms = extractQueryTerms(source.title);
    if (terms.length === 0 || scope.memberTeamIds.length === 0) {
      return [];
    }
    // OR semantics: a duplicate rarely shares every word of the title, which is
    // what `plainto_tsquery` (AND) would demand.
    const tsQuery = terms.join(' | ');
    const guestFilter =
      scope.guestTeamIds.length > 0
        ? Prisma.sql`AND (
            i.team_id != ALL(${scope.guestTeamIds}::uuid[])
            OR i.creator_id = ${scope.userId}::uuid
            OR i.assignee_id = ${scope.userId}::uuid
          )`
        : Prisma.sql``;

    // One shared match among generic words ("page", "customer") is noise, so a
    // title with 3+ usable terms must share at least two of them. Matching is
    // per-term through `plainto_tsquery`, so it is stem-aware ("statuses" ~
    // "status") and the same array doubles as the "why" shown to the user.
    const minMatches = terms.length >= 3 ? 2 : 1;
    const rows = await this.prisma.$queryRaw<
      Array<{ id: string; matched: string[]; score: number }>
    >(
      Prisma.sql`
        SELECT c.id, c.score, c.matched
        FROM (
          SELECT i.id,
                 i.created_at,
                 ts_rank(v.tsv, to_tsquery('english', ${tsQuery}))
                   * (CASE WHEN i.team_id = ${source.teamId}::uuid THEN 1.0 ELSE 0.8 END) AS score,
                 ARRAY(
                   SELECT t FROM unnest(${terms}::text[]) AS t
                   WHERE v.tsv @@ plainto_tsquery('english', t)
                 ) AS matched
          FROM issues i
          JOIN workflow_states ws ON ws.id = i.state_id
          CROSS JOIN LATERAL (
            SELECT to_tsvector('english', i.title || ' ' || COALESCE(i.description, '')) AS tsv
          ) v
          WHERE i.organization_id = ${orgId}::uuid
            AND i.id != ${source.id}::uuid
            AND i.archived_at IS NULL
            AND i.trashed = false
            AND ws.type::text != 'triage'
            AND i.team_id = ANY(${scope.memberTeamIds}::uuid[])
            ${guestFilter}
            AND v.tsv @@ to_tsquery('english', ${tsQuery})
        ) c
        WHERE cardinality(c.matched) >= ${minMatches}
        ORDER BY c.score DESC, c.created_at DESC
        LIMIT ${limit}
      `,
    );
    return rows.map(r => ({ issueId: r.id, matchedTerms: r.matched, score: Number(r.score) }));
  }
}

export class DuplicateSuggestionService {
  constructor(
    private prisma: PrismaClient,
    private scorer: DuplicateScorer = new FtsDuplicateScorer(prisma),
  ) {}

  async suggest(
    orgId: string,
    issueId: string,
    scope: SearchVisibilityScope,
    first = DEFAULT_DUPLICATE_SUGGESTIONS,
  ): Promise<DuplicateSuggestionResult[]> {
    const limit = Math.min(Math.max(Math.trunc(first) || 0, 0), MAX_DUPLICATE_SUGGESTIONS);
    if (limit === 0) {
      return [];
    }
    const source = await this.prisma.issue.findFirst({
      select: { description: true, id: true, teamId: true, title: true },
      where: { id: issueId, organizationId: orgId },
    });
    if (!source) {
      throw new DuplicateSourceNotFoundError();
    }
    const scored = await this.scorer.score({ limit, orgId, scope, source });
    if (scored.length === 0) {
      return [];
    }
    const capped = scored.slice(0, limit);
    // Re-assert the invariants on hydration so a faulty (or future AI) scorer
    // cannot leak a hidden/archived row into the response.
    const rows = await this.prisma.issue.findMany({
      where: {
        archivedAt: null,
        id: { in: capped.map(c => c.issueId), not: source.id },
        organizationId: orgId,
        state: { type: { not: 'triage' } },
        teamId: { in: scope.memberTeamIds },
        trashed: false,
      },
    });
    const byId = new Map(rows.map(r => [r.id, r]));
    const sourceTerms = extractQueryTerms(source.title);
    const results: DuplicateSuggestionResult[] = [];
    for (const c of capped) {
      const issue = byId.get(c.issueId);
      if (!issue) {
        continue;
      }
      if (scope.guestTeamIds.includes(issue.teamId)) {
        if (issue.creatorId !== scope.userId && issue.assigneeId !== scope.userId) {
          continue;
        }
      }
      const haystack = new Set(extractQueryTerms(`${issue.title} ${issue.description ?? ''}`));
      results.push({
        issue,
        matchedTerms: c.matchedTerms ?? sourceTerms.filter(term => haystack.has(term)),
        score: c.score,
      });
    }
    return results;
  }
}
