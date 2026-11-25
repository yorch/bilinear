import type { Issue, PrismaClient } from '../../generated/prisma';
import { Prisma } from '../../generated/prisma';
import type { SearchVisibilityScope } from './search.service';

/** Hard ceiling on suggestions, whatever the caller asks for. */
export const MAX_DUPLICATE_SUGGESTIONS = 5;
export const DEFAULT_DUPLICATE_SUGGESTIONS = 3;
/** Query terms handed to Postgres; a long title must not become a long tsquery. */
const MAX_TERMS = 12;
const MIN_TERM_LENGTH = 3;

/**
 * Minimum `similarity()` for the trigram fallback. 0.3 is pg_trgm's own default
 * for `%`; it is spelled out here (and applied with `similarity() >=` beside
 * the index-served `%`) so a changed `pg_trgm.similarity_threshold` GUC can
 * only ever make the result stricter, never looser than this.
 */
export const TRIGRAM_MIN_SIMILARITY = 0.3;

/**
 * Scripts written without spaces between words. The `english` FTS
 * configuration sees a whole clause as one token in these, so word matching
 * degenerates to "identical run of characters". Hangul is deliberately absent:
 * Korean is space-separated.
 */
const NO_SPACE_SCRIPT =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u;

export function hasNoSpaceScript(text: string): boolean {
  return NO_SPACE_SCRIPT.test(text);
}

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
 * source issue and archived/trashed issues. Canceled issues may only be returned
 * when they carry a `duplicate` relation (the service follows it to the live
 * canonical issue). Triage peers are valid candidates. The service re-verifies
 * visibility on hydration but does not re-rank.
 */
export interface DuplicateScorer {
  score(request: DuplicateScoreRequest): Promise<ScoredCandidate[]>;
}

export interface DuplicateSuggestionResult {
  /** The suggested issue is itself still awaiting triage (resolve the pair against each other). */
  inTriage: boolean;
  issue: Issue;
  matchedTerms: string[];
  score: number;
}

/** Pairs of an issue's terms are index-gated, so this only bounds the ranking pass. */
const CANDIDATE_CAP = 300;
/** `duplicate-of` chains followed to reach a live canonical issue. */
const MAX_CANONICAL_HOPS = 3;

/** True for a 2-character token that is a plausible acronym ("CI", "UI", "Q4") or CJK word. */
function isShortToken(raw: string): boolean {
  return [...raw].length === 2 && raw === raw.toUpperCase() && /\p{L}/u.test(raw);
}

/**
 * Reduce free text to candidate search terms. Splitting is Unicode-aware
 * (`\p{L}\p{N}\p{M}`), so "sesión", "Größe" and "导出" survive intact instead of
 * being cut at the first non-ASCII letter. Terms are only ever passed to
 * Postgres as a bound `text[]` and re-parsed by `plainto_tsquery`, so no
 * tsquery operator in the user's text can reach the query.
 *
 * Words shorter than three characters are dropped, except two-character
 * all-caps tokens ("CI", "UI", "QA") which are routinely the whole point of a
 * title. Stop words ("for", "you") survive here and are dropped in SQL, where
 * the FTS configuration decides what a stop word is.
 *
 * Limitation: languages written without spaces (Chinese, Japanese, Thai) produce
 * one long token per clause, so FTS only matches an identical run of characters;
 * `LanguageAwareDuplicateScorer` routes those titles to trigram similarity.
 */
export function extractQueryTerms(text: string): string[] {
  const seen = new Set<string>();
  for (const raw of text.normalize('NFC').split(/[^\p{L}\p{N}\p{M}]+/u)) {
    if (!raw) {
      continue;
    }
    const term = raw.toLowerCase();
    if (([...term].length >= MIN_TERM_LENGTH || isShortToken(raw)) && !seen.has(term)) {
      seen.add(term);
      if (seen.size >= MAX_TERMS) {
        break;
      }
    }
  }
  return [...seen];
}

/**
 * Full-text scorer over the same `to_tsvector('english', title || ' ' || …)`
 * expression `idx_issues_fts` is built on, so the GIN index serves the lookup.
 *
 * Shape of the query (all in one round trip):
 *  1. `live` — each term through `plainto_tsquery`; terms that reduce to
 *     nothing (stop words) are dropped BEFORE the match threshold is set, so
 *     "Broken for you" is a one-term search, not a three-term search that can
 *     never reach two matches.
 *  2. `gate` — the index condition. With 3+ live terms it is the OR of every
 *     pair ("shares at least two terms"), so the GIN index already enforces the
 *     threshold; otherwise a plain OR.
 *  3. `hits` → `recent` — gated rows, newest first, capped at CANDIDATE_CAP.
 *     The tsvector is NOT in the select list, so Postgres never recomputes it
 *     for rows the index already accepted (the old LATERAL form re-ran
 *     to_tsvector per row per term: 10 s at 20k issues, ~80 ms now).
 *  4. `top` ranks only the capped set; `matched` is computed for the final few.
 */
export class FtsDuplicateScorer implements DuplicateScorer {
  constructor(private prisma: PrismaClient) {}

  async score({ limit, orgId, scope, source }: DuplicateScoreRequest): Promise<ScoredCandidate[]> {
    const terms = extractQueryTerms(source.title);
    if (terms.length === 0 || scope.memberTeamIds.length === 0) {
      return [];
    }
    const guestFilter = guestVisibility(scope);

    const rows = await this.prisma.$queryRaw<
      Array<{ id: string; matched: string[]; score: number }>
    >(
      Prisma.sql`
        WITH q AS (
          SELECT t.term, plainto_tsquery('english', t.term) AS tq
          FROM unnest(${terms}::text[]) AS t(term)
        ), live AS MATERIALIZED (
          SELECT term, tq FROM q WHERE numnode(tq) > 0
        ), gate AS MATERIALIZED (
          SELECT
            string_agg('(' || tq::text || ')', ' | ')::tsquery AS any_q,
            CASE WHEN count(*) >= 3 THEN
              (SELECT string_agg('(' || a.tq::text || ' & ' || b.tq::text || ')', ' | ')::tsquery
                 FROM live a JOIN live b ON a.term < b.term)
            ELSE string_agg('(' || tq::text || ')', ' | ')::tsquery END AS gate_q
          FROM live
        ), hits AS MATERIALIZED (
          SELECT i.id, i.created_at, i.team_id
          FROM gate g, issues i
          JOIN workflow_states ws ON ws.id = i.state_id
          WHERE i.organization_id = ${orgId}::uuid
            AND i.id != ${source.id}::uuid
            AND i.archived_at IS NULL
            AND i.trashed = false
            AND (
              ws.type::text != 'canceled'
              OR EXISTS (
                SELECT 1 FROM issue_relations r
                WHERE r.issue_id = i.id AND r.type = 'duplicate'
              )
            )
            AND i.team_id = ANY(${scope.memberTeamIds}::uuid[])
            ${guestFilter}
            AND to_tsvector('english', i.title || ' ' || COALESCE(i.description, '')) @@ g.gate_q
        ), recent AS MATERIALIZED (
          SELECT id, created_at, team_id FROM hits ORDER BY created_at DESC LIMIT ${CANDIDATE_CAP}
        ), top AS MATERIALIZED (
          SELECT i.id, i.created_at,
                 ts_rank(to_tsvector('english', i.title || ' ' || COALESCE(i.description, '')), g.any_q)
                   * (CASE WHEN i.team_id = ${source.teamId}::uuid THEN 1.0 ELSE 0.8 END) AS score
          FROM gate g, recent r JOIN issues i ON i.id = r.id
          ORDER BY score DESC, i.created_at DESC
          LIMIT ${limit}
        )
        SELECT top.id, top.score,
               ARRAY(
                 SELECT l.term FROM live l
                 WHERE to_tsvector('english', i.title || ' ' || COALESCE(i.description, '')) @@ l.tq
               ) AS matched
        FROM top JOIN issues i ON i.id = top.id
        ORDER BY top.score DESC, top.created_at DESC
      `,
    );
    return rows.map(r => ({ issueId: r.id, matchedTerms: r.matched, score: Number(r.score) }));
  }
}

/** Candidate-visibility predicate shared by every SQL scorer. */
function guestVisibility(scope: SearchVisibilityScope) {
  return scope.guestTeamIds.length > 0
    ? Prisma.sql`AND (
        i.team_id != ALL(${scope.guestTeamIds}::uuid[])
        OR i.creator_id = ${scope.userId}::uuid
        OR i.assignee_id = ${scope.userId}::uuid
      )`
    : Prisma.sql``;
}

/**
 * Trigram scorer (`pg_trgm`) over `issues.title`, served by
 * `idx_issues_title_trgm` through the `%` operator. It exists for titles the
 * FTS scorer cannot tokenise: Chinese, Japanese, Thai and similar scripts, and
 * as a typo-tolerant fallback when FTS finds nothing. Same visibility, archived,
 * trashed and canceled-without-duplicate rules as the FTS scorer. `matchedTerms`
 * is left undefined (trigrams have no word-level match), so the service derives
 * it from whole-token overlap. Scores are `similarity()` in 0..1, a different
 * scale from `ts_rank`; callers never mix the two in one ranking.
 */
export class TrigramDuplicateScorer implements DuplicateScorer {
  constructor(private prisma: PrismaClient) {}

  async score({ limit, orgId, scope, source }: DuplicateScoreRequest): Promise<ScoredCandidate[]> {
    const title = source.title.normalize('NFC').trim();
    if (!title || scope.memberTeamIds.length === 0) {
      return [];
    }
    const rows = await this.prisma.$queryRaw<Array<{ id: string; score: number }>>(
      Prisma.sql`
        SELECT i.id,
               similarity(i.title, ${title}::text)
                 * (CASE WHEN i.team_id = ${source.teamId}::uuid THEN 1.0 ELSE 0.8 END) AS score
        FROM issues i
        JOIN workflow_states ws ON ws.id = i.state_id
        WHERE i.organization_id = ${orgId}::uuid
          AND i.id != ${source.id}::uuid
          AND i.archived_at IS NULL
          AND i.trashed = false
          AND (
            ws.type::text != 'canceled'
            OR EXISTS (
              SELECT 1 FROM issue_relations r
              WHERE r.issue_id = i.id AND r.type = 'duplicate'
            )
          )
          AND i.team_id = ANY(${scope.memberTeamIds}::uuid[])
          ${guestVisibility(scope)}
          AND i.title % ${title}::text
          AND similarity(i.title, ${title}::text) >= ${TRIGRAM_MIN_SIMILARITY}
        ORDER BY score DESC, i.created_at DESC
        LIMIT ${limit}
      `,
    );
    return rows.map(r => ({ issueId: r.id, score: Number(r.score) }));
  }
}

/**
 * Default scorer. Titles containing a no-space script go to the trigram scorer
 * first (FTS only matches an identical run of characters there); every other
 * title goes to FTS first. Whichever came first is tried again with the other
 * when it returns nothing, so a Japanese title that happens to share an exact
 * run still matches, and a misspelt English one still finds its neighbour.
 */
export class LanguageAwareDuplicateScorer implements DuplicateScorer {
  constructor(
    private fts: DuplicateScorer,
    private trigram: DuplicateScorer,
  ) {}

  async score(request: DuplicateScoreRequest): Promise<ScoredCandidate[]> {
    const [first, second] = hasNoSpaceScript(request.source.title)
      ? [this.trigram, this.fts]
      : [this.fts, this.trigram];
    const primary = await first.score(request);
    return primary.length > 0 ? primary : second.score(request);
  }
}

export class DuplicateSuggestionService {
  constructor(
    private prisma: PrismaClient,
    private scorer: DuplicateScorer = new LanguageAwareDuplicateScorer(
      new FtsDuplicateScorer(prisma),
      new TrigramDuplicateScorer(prisma),
    ),
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
    const visible = {
      archivedAt: null,
      organizationId: orgId,
      teamId: { in: scope.memberTeamIds },
      trashed: false,
    } as const;
    const rows = await this.prisma.issue.findMany({
      include: { state: { select: { type: true } } },
      where: { ...visible, id: { in: capped.map(c => c.issueId), not: source.id } },
    });
    const byId = new Map(rows.map(r => [r.id, r]));
    const sourceTerms = extractQueryTerms(source.title);
    const results: DuplicateSuggestionResult[] = [];
    const taken = new Set<string>();
    for (const c of capped) {
      let issue = byId.get(c.issueId);
      // A canceled candidate is only useful as a pointer to what it duplicates:
      // suggesting it would build duplicate-of-duplicate chains. Follow the
      // `duplicate` relation to the live canonical issue; a declined issue (no
      // relation) or a chain that dead-ends is dropped.
      for (
        let hop = 0;
        issue && issue.state.type === 'canceled' && hop < MAX_CANONICAL_HOPS;
        hop++
      ) {
        const link = await this.prisma.issueRelation.findFirst({
          orderBy: { createdAt: 'desc' },
          select: { relatedIssueId: true },
          where: { issueId: issue.id, type: 'duplicate' },
        });
        issue = link
          ? ((await this.prisma.issue.findFirst({
              include: { state: { select: { type: true } } },
              where: { ...visible, id: link.relatedIssueId },
            })) ?? undefined)
          : undefined;
      }
      if (
        !issue ||
        issue.state.type === 'canceled' ||
        issue.id === source.id ||
        taken.has(issue.id)
      ) {
        continue;
      }
      if (scope.guestTeamIds.includes(issue.teamId)) {
        if (issue.creatorId !== scope.userId && issue.assigneeId !== scope.userId) {
          continue;
        }
      }
      taken.add(issue.id);
      const { state, ...plain } = issue;
      const haystack = new Set(extractQueryTerms(`${issue.title} ${issue.description ?? ''}`));
      results.push({
        inTriage: state.type === 'triage',
        issue: plain as Issue,
        matchedTerms: c.matchedTerms ?? sourceTerms.filter(term => haystack.has(term)),
        score: c.score,
      });
    }
    return results;
  }
}
