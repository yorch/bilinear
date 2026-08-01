import { action, computed, makeObservable, observable } from 'mobx';
import type { DBIssue } from '@/lib/db';
import { fuzzyScore } from '@/lib/fuzzy-search';

/**
 * Collapse the three label shapes the server can send into the single
 * `labelIds` form `DBIssue` declares:
 *
 * - `labelAssignments` — the Prisma relation, on SyncAction payloads
 * - `labels`           — on GraphQL mutation responses
 * - `labelIds`         — already normalized, from bootstrap
 *
 * A payload that says nothing about labels is NOT the same as an issue with no
 * labels: archive/unarchive/snooze/triage/rollover all broadcast a bare issue
 * row. Falling back to `[]` there wiped the label chips off every client on an
 * operation that never touched labels — so fall back to `previousLabelIds`.
 *
 * Exported because both the MobX pool and the Dexie write need the identical
 * result. Normalizing in only one of them is what made the loss survive a
 * reload: `loadFromIndexedDB()` hydrates the persisted row verbatim, and the
 * cached-data path then takes `deltaSync()` rather than re-bootstrapping, so
 * nothing ever repaired it.
 */
export function normalizeIssueRow(data: DBIssue, previousLabelIds?: string[]): DBIssue {
  const { labelAssignments, labels, ...issueData } = data as DBIssue & {
    labelAssignments?: Array<{ labelId: string }>;
    labels?: Array<{ id: string }>;
  };
  const labelIds = labelAssignments
    ? labelAssignments.map(a => a.labelId)
    : labels
      ? labels.map(l => l.id)
      : (issueData.labelIds ?? (previousLabelIds ? [...previousLabelIds] : []));
  return { ...issueData, labelIds };
}

export class IssueStore {
  pool = new Map<string, DBIssue>();

  constructor() {
    makeObservable(this, {
      all: computed,
      applySyncAction: action,
      optimisticUpdate: action,
      pool: observable,
      upsertMany: action,
    });
  }

  get all(): DBIssue[] {
    return Array.from(this.pool.values()).filter(i => !i.trashed && !i.archivedAt);
  }

  findById(id: string): DBIssue | null {
    return this.pool.get(id) ?? null;
  }

  /**
   * Linear scan for an exact identifier match (e.g. `ENG-42`). Identifiers
   * are unique per org so the first hit terminates. Used by the command
   * palette's instant-jump path; keeping this inline (no `computed`) means
   * we don't add another iterator over `pool` to MobX's dependency graph.
   */
  findByIdentifier(identifier: string): DBIssue | null {
    for (const issue of this.pool.values()) {
      if (issue.identifier === identifier) {
        return issue;
      }
    }
    return null;
  }

  findByTeamId(teamId: string): DBIssue[] {
    return Array.from(this.pool.values()).filter(
      i => i.teamId === teamId && !i.trashed && !i.archivedAt,
    );
  }

  /**
   * Local fuzzy search across issue titles and identifiers.
   * Returns up to `limit` issues ranked by match quality.
   * Falls back to server full-text search for description matching.
   *
   * Note: `search` is intentionally omitted from `makeObservable`. It is a pure
   * read-only method (no side effects, no observable writes) so MobX tracking is
   * not needed. Callers that want reactivity should observe `pool` directly and
   * call `search` inside an `observer` component or a `computed` expression.
   */
  search(query: string, limit = 20): DBIssue[] {
    if (!query.trim()) {
      return [];
    }

    const trimmed = query.trim();

    // Single pass: score each issue against identifier (1.2× boost) and title simultaneously
    return Array.from(this.pool.values())
      .filter(i => !i.trashed && !i.archivedAt)
      .map(issue => ({
        issue,
        score: fuzzyScore(issue.identifier, trimmed) * 1.2 + fuzzyScore(issue.title, trimmed),
      }))
      .filter(m => m.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(m => m.issue);
  }

  findByCycleId(cycleId: string): DBIssue[] {
    return Array.from(this.pool.values()).filter(
      i => i.cycleId === cycleId && !i.trashed && !i.archivedAt,
    );
  }

  findByProjectId(projectId: string): DBIssue[] {
    return Array.from(this.pool.values()).filter(
      i => i.projectId === projectId && !i.trashed && !i.archivedAt,
    );
  }

  findByStateId(stateId: string): DBIssue[] {
    return Array.from(this.pool.values()).filter(
      i => i.stateId === stateId && !i.trashed && !i.archivedAt,
    );
  }

  /**
   * Optimistically apply a partial patch to an issue in the pool.
   * Used by TransactionQueue before the server responds.
   */
  optimisticUpdate(id: string, patch: Partial<DBIssue>) {
    const existing = this.pool.get(id);
    if (existing) {
      this.pool.set(id, { ...existing, ...patch });
    }
  }

  upsertMany(issues: DBIssue[]) {
    for (const issue of issues) {
      this.pool.set(issue.id, issue);
    }
  }

  applySyncAction(action: string, id: string, data: DBIssue | null) {
    if (action === 'I' || action === 'U' || action === 'A') {
      if (data) {
        const { labelIds, ...issueData } = normalizeIssueRow(data, this.pool.get(id)?.labelIds);

        // When a real issue arrives (non-optimistic identifier), atomically
        // remove any optimistic placeholder for the same title/team so the
        // list never shows both at once. The team page creates optimistic
        // entries with identifier `<TEAM_KEY>-…` (e.g. "ENG-…"), so match
        // on the trailing ellipsis rather than an exact-equals check.
        const isOptimisticIdentifier = (ident: string) => ident.endsWith('…');
        if (action === 'I' && !isOptimisticIdentifier(issueData.identifier)) {
          for (const [existingId, existing] of this.pool) {
            if (
              existingId !== id &&
              isOptimisticIdentifier(existing.identifier) &&
              existing.title === issueData.title &&
              existing.teamId === issueData.teamId
            ) {
              this.pool.delete(existingId);
              break;
            }
          }
        }

        this.pool.set(id, { ...issueData, labelIds });
      }
    } else if (action === 'D') {
      this.pool.delete(id);
    }
  }
}
