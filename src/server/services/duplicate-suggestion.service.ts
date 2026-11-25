import type { Issue, PrismaClient } from '../../generated/prisma';
import { Prisma } from '../../generated/prisma';
import { childLogger } from '../lib/logger';
import type { SearchVisibilityScope } from './search.service';

/** Hard ceiling on suggestions, whatever the caller asks for. */
export const MAX_DUPLICATE_SUGGESTIONS = 5;
export const DEFAULT_DUPLICATE_SUGGESTIONS = 3;
/** Query terms handed to Postgres; a long title must not become a long tsquery. */
const MAX_TERMS = 12;
const MIN_TERM_LENGTH = 3;

/**
 * Minimum `similarity()` for trigram matches on no-space-script titles, where
 * trigram is the PRIMARY scorer. Real short rewordings score low
 * (`导出失败`/`导出成功` = 0.25) and pg_trgm's default 0.3 sat just under or over
 * the test pairs (Japanese 0.304), so 0.22 keeps those while unrelated titles
 * still score 0.0-0.08 (a shared boilerplate phrase can reach ~0.26; that is a
 * near-duplicate worth showing). `%` reads the `pg_trgm.similarity_threshold`
 * GUC, so the scorer lowers it per transaction to this value; the explicit
 * `similarity() >=` beside it is the real floor.
 */
export const TRIGRAM_MIN_SIMILARITY = 0.22;

/**
 * Stricter floor for the typo-tolerance fallback on space-separated titles,
 * where FTS already had its say and a miss usually means "not a duplicate".
 * Real typos score ~0.6; same-template titles ("Fix login bug"/"Fix signup
 * bug" 0.38, "Checkout totals incorrect"/"Checkout page loads slowly" 0.20) do
 * not belong here.
 */
export const TRIGRAM_FALLBACK_MIN_SIMILARITY = 0.4;
/** The Latin typo fallback only runs for short titles, under a hard time cap. */
export const TRIGRAM_FALLBACK_MAX_TERMS = 8;
export const TRIGRAM_FALLBACK_MAX_CHARS = 80;
export const TRIGRAM_FALLBACK_TIMEOUT_MS = 300;
const TRIGRAM_PRIMARY_TIMEOUT_MS = 2000;

const log = childLogger({ module: 'duplicate-suggestion' });

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
  /**
   * Set when the scorer is only a best-effort typo fallback after FTS found
   * nothing: it then uses the stricter floor, a short statement timeout, and
   * swallows a timeout instead of failing the suggestion request.
   */
  fallback?: boolean;
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

  async score({
    fallback = false,
    limit,
    orgId,
    scope,
    source,
  }: DuplicateScoreRequest): Promise<ScoredCandidate[]> {
    const title = source.title.normalize('NFC').trim();
    if (!title || scope.memberTeamIds.length === 0) {
      return [];
    }
    await warnIfTrigramIneffective(this.prisma);
    const minSimilarity = fallback ? TRIGRAM_FALLBACK_MIN_SIMILARITY : TRIGRAM_MIN_SIMILARITY;
    const timeoutMs = fallback ? TRIGRAM_FALLBACK_TIMEOUT_MS : TRIGRAM_PRIMARY_TIMEOUT_MS;
    try {
      // One transaction so the two SET LOCAL-style settings and the query share a
      // connection: `%` is index-served at the GUC threshold, which must sit at
      // or below our floor, and the timeout bounds a non-org-scoped GIN scan.
      const [, rows] = await this.prisma.$transaction([
        this.prisma
          .$queryRaw`SELECT set_config('pg_trgm.similarity_threshold', ${String(minSimilarity)}, true),
                                     set_config('statement_timeout', ${String(timeoutMs)}, true)`,
        this.prisma.$queryRaw<Array<{ id: string; score: number }>>(
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
          AND similarity(i.title, ${title}::text) >= ${minSimilarity}
        ORDER BY score DESC, i.created_at DESC
        LIMIT ${limit}
      `,
        ),
      ]);
      return (rows as Array<{ id: string; score: number }>).map(r => ({
        issueId: r.id,
        score: Number(r.score),
      }));
    } catch (error) {
      if (!fallback) {
        throw error;
      }
      // A best-effort typo lookup must never fail (or slow) the whole request.
      log.warn({ err: error }, 'trigram typo fallback skipped');
      return [];
    }
  }
}

let trigramCheck: Promise<void> | undefined;

/**
 * pg_trgm only extracts trigrams from characters the database's `LC_CTYPE`
 * treats as alphanumeric. Under `LC_CTYPE=C` every CJK/Thai title yields no
 * trigrams, so the scorer silently returns nothing for the titles it exists
 * for. Check once per process and say so loudly. Never throws.
 */
export function warnIfTrigramIneffective(prisma: PrismaClient): Promise<void> {
  trigramCheck ??= (async () => {
    try {
      const rows = await prisma.$queryRaw<Array<{ ok: boolean }>>`
        SELECT show_trgm('导出') <> '{}'::text[] AS ok`;
      if (Array.isArray(rows) && rows[0]?.ok === false) {
        log.warn(
          'pg_trgm extracts no trigrams for non-Latin text: this database has LC_CTYPE=C. ' +
            'Duplicate suggestions for Chinese/Japanese/Thai titles will return nothing. ' +
            'Recreate the database with a UTF-8 ctype (e.g. C.UTF-8 or en_US.UTF-8); see docs/DATABASE_SCHEMA.md.',
        );
      }
    } catch (error) {
      log.warn({ err: error }, 'could not verify pg_trgm trigram extraction');
    }
  })();
  return trigramCheck;
}

/** Test seam: forget the cached one-time ctype check. */
export function resetTrigramCheckForTests(): void {
  trigramCheck = undefined;
}

/** Round-robin merge of rankings whose scores are not comparable, de-duplicated by issue. */
function interleave(lists: ScoredCandidate[][], limit: number): ScoredCandidate[] {
  const out: ScoredCandidate[] = [];
  const seen = new Set<string>();
  for (let i = 0; out.length < limit && lists.some(l => i < l.length); i++) {
    for (const list of lists) {
      const c = list[i];
      if (c && !seen.has(c.issueId) && out.length < limit) {
        seen.add(c.issueId);
        out.push(c);
      }
    }
  }
  return out;
}

/** Is a title short enough for the (non-org-scoped) trigram typo fallback? */
function suitsTypoFallback(title: string): boolean {
  return (
    title.length <= TRIGRAM_FALLBACK_MAX_CHARS &&
    extractQueryTerms(title).length <= TRIGRAM_FALLBACK_MAX_TERMS
  );
}

/**
 * Default scorer.
 *  - Titles containing a no-space script run FTS and trigram together and merge
 *    the two rankings (round-robin, trigram first; their scores are on
 *    different scales). A mixed title like "Export 失败 on Safari" therefore
 *    keeps its FTS word matches instead of losing them to whichever scorer
 *    answered first.
 *  - Every other title goes to FTS. Only when FTS finds nothing, and the title
 *    is short, is trigram tried as a typo-tolerant fallback, with a stricter
 *    floor and a statement timeout (`fallback: true`): most issues are not
 *    duplicates, so this is the common path and must stay cheap.
 */
export class LanguageAwareDuplicateScorer implements DuplicateScorer {
  constructor(
    private fts: DuplicateScorer,
    private trigram: DuplicateScorer,
  ) {}

  async score(request: DuplicateScoreRequest): Promise<ScoredCandidate[]> {
    if (hasNoSpaceScript(request.source.title)) {
      const [trigram, fts] = await Promise.all([
        this.trigram.score(request),
        this.fts.score(request),
      ]);
      return interleave([trigram, fts], request.limit);
    }
    const primary = await this.fts.score(request);
    if (primary.length > 0 || !suitsTypoFallback(request.source.title)) {
      return primary;
    }
    return this.trigram.score({ ...request, fallback: true });
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
