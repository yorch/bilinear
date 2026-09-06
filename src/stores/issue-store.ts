import { action, computed, makeObservable, observable, observableShallow } from 'mobx';
import type { DBIssue, IssueSyncRow } from '@/lib/db';
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
export function normalizeIssueRow(data: IssueSyncRow, previousLabelIds?: string[]): DBIssue {
  const { labelAssignments, labels, ...issueData } = data;
  const labelIds = labelAssignments
    ? labelAssignments.map(a => a.labelId)
    : labels
      ? labels.map(l => l.id)
      : (issueData.labelIds ?? (previousLabelIds ? [...previousLabelIds] : []));
  return { ...issueData, labelIds };
}

export class IssueStore {
  pool = new Map<string, DBIssue>();

  /**
   * Secondary index: `teamId → Set<issueId>`. Maintained alongside `pool` so
   * `findByTeamId` scans only one team's bucket AND — the real win — re-runs in
   * an observer component ONLY when that team's membership changes, not on
   * every pool mutation. The old `Array.from(pool.values()).filter` read the
   * whole pool's key set, so any issue add/remove anywhere re-ran every
   * team-list selector; on a 10k-issue store that is a lot of wasted work.
   *
   * `observableShallow` so the bucket `Set`s are stored by reference (not
   * deep-converted to ObservableSets). Membership changes REPLACE a team's
   * `Set` with a fresh copy — that reference swap is what fires the per-key
   * observers; a same-team field update leaves the bucket untouched (the row
   * re-renders via its own `pool.get(id)` subscription instead). See
   * `indexAdd`/`indexRemove`/`setIssue`. Only `byTeam` is indexed today —
   * `findByCycleId`/`findByProjectId`/`findByStateId` still scan (lower
   * traffic); add more buckets here if they become hot.
   */
  private byTeam = new Map<string, Set<string>>();

  constructor() {
    makeObservable<IssueStore, 'byTeam'>(this, {
      all: computed,
      applySyncAction: action,
      byTeam: observableShallow,
      optimisticUpdate: action,
      pool: observable,
      upsertMany: action,
    });
  }

  /** Add `issue.id` to its team bucket. No-op (no reference swap, so no
   * observer fire) when already present — a same-team field update must not
   * churn the bucket. */
  private indexAdd(id: string, teamId: string) {
    const prev = this.byTeam.get(teamId);
    if (prev?.has(id)) {
      return;
    }
    const next = prev ? new Set(prev) : new Set<string>();
    next.add(id);
    this.byTeam.set(teamId, next);
  }

  /** Remove `id` from `teamId`'s bucket, dropping the bucket when it empties. */
  private indexRemove(id: string, teamId: string) {
    const prev = this.byTeam.get(teamId);
    if (!prev?.has(id)) {
      return;
    }
    const next = new Set(prev);
    next.delete(id);
    if (next.size === 0) {
      this.byTeam.delete(teamId);
    } else {
      this.byTeam.set(teamId, next);
    }
  }

  /** Single-issue upsert that keeps `byTeam` in sync, moving the id between
   * buckets when its `teamId` changes. */
  private setIssue(issue: DBIssue) {
    const prev = this.pool.get(issue.id);
    if (prev && prev.teamId !== issue.teamId) {
      this.indexRemove(issue.id, prev.teamId);
    }
    this.pool.set(issue.id, issue);
    this.indexAdd(issue.id, issue.teamId);
  }

  /** Single-issue delete that keeps `byTeam` in sync. */
  private deleteIssue(id: string) {
    const prev = this.pool.get(id);
    this.pool.delete(id);
    if (prev) {
      this.indexRemove(id, prev.teamId);
    }
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
    const ids = this.byTeam.get(teamId);
    if (!ids) {
      return [];
    }
    // The bucket holds every issue on the team (incl. trashed/archived); the
    // active-only filter is applied on read. An observer here subscribes to
    // this team's bucket entry + each read `pool.get(id)`, so it re-runs on a
    // membership change to THIS team or a field change to one of ITS issues —
    // not on activity in other teams.
    const result: DBIssue[] = [];
    for (const id of ids) {
      const issue = this.pool.get(id);
      if (issue && !issue.trashed && !issue.archivedAt) {
        result.push(issue);
      }
    }
    return result;
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
      // Route through setIssue so a patch that changes `teamId` moves the id
      // between buckets.
      this.setIssue({ ...existing, ...patch });
    }
  }

  upsertMany(issues: DBIssue[]) {
    // Bulk path: accumulate each touched team's membership once and replace its
    // bucket a single time, instead of copying a team's Set per inserted issue
    // (which is O(n²) when bootstrapping thousands of issues into one team).
    const touched = new Map<string, Set<string>>();
    // Only teams whose MEMBERSHIP actually changed (an id added or moved out).
    // A bulk update of existing same-team issues (a delta page of field-only
    // edits, a bulk status change) must NOT swap those teams' bucket
    // references, or every one of their list selectors re-runs for nothing —
    // the exact wasted work the index exists to avoid. Same no-op-on-unchanged
    // guarantee the single-issue `indexAdd`/`setIssue` path gives.
    const changed = new Set<string>();
    const bucket = (teamId: string): Set<string> => {
      let b = touched.get(teamId);
      if (!b) {
        b = new Set(this.byTeam.get(teamId) ?? []);
        touched.set(teamId, b);
      }
      return b;
    };
    for (const issue of issues) {
      const prev = this.pool.get(issue.id);
      if (prev && prev.teamId !== issue.teamId) {
        // `Set.delete` returns true only if the id was actually present.
        if (bucket(prev.teamId).delete(issue.id)) {
          changed.add(prev.teamId);
        }
      }
      this.pool.set(issue.id, issue);
      const b = bucket(issue.teamId);
      if (!b.has(issue.id)) {
        b.add(issue.id);
        changed.add(issue.teamId);
      }
    }
    for (const teamId of changed) {
      const ids = touched.get(teamId);
      if (!ids || ids.size === 0) {
        this.byTeam.delete(teamId);
      } else {
        this.byTeam.set(teamId, ids);
      }
    }
  }

  applySyncAction(action: string, id: string, data: IssueSyncRow | null) {
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
              this.deleteIssue(existingId);
              break;
            }
          }
        }

        this.setIssue({ ...issueData, labelIds });
      }
    } else if (action === 'D') {
      this.deleteIssue(id);
    }
  }
}
