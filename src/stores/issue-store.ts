import { action, computed, makeObservable, observable } from 'mobx';
import type { DBIssue } from '@/lib/db';
import { fuzzySearch } from '@/lib/fuzzy-search';

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
    return Array.from(this.pool.values()).filter(
      i => !i.trashed && !i.archivedAt,
    );
  }

  findById(id: string): DBIssue | null {
    return this.pool.get(id) ?? null;
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
    const active = Array.from(this.pool.values()).filter(
      i => !i.trashed && !i.archivedAt,
    );

    // Score against identifier first (exact wins), then title
    const byIdentifier = fuzzySearch(active, trimmed, i => i.identifier);
    const byTitle = fuzzySearch(active, trimmed, i => i.title);

    // Merge: identifier matches get a 20% boost
    const scoreMap = new Map<string, number>();
    for (const { item, score } of byIdentifier) {
      scoreMap.set(item.id, (scoreMap.get(item.id) ?? 0) + score * 1.2);
    }
    for (const { item, score } of byTitle) {
      scoreMap.set(item.id, (scoreMap.get(item.id) ?? 0) + score);
    }

    return Array.from(scoreMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([id]) => this.pool.get(id))
      .filter((issue): issue is DBIssue => issue !== undefined);
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
        // Sync action data from the server may include `labelAssignments` (full Prisma relation).
        // Bootstrap data includes `labelIds` directly. Handle both.
        const raw = data as DBIssue & {
          labelAssignments?: Array<{ labelId: string }>;
        };
        const { labelAssignments, ...issueData } = raw;
        const labelIds = labelAssignments
          ? labelAssignments.map(a => a.labelId)
          : (issueData.labelIds ?? []);
        this.pool.set(id, { ...issueData, labelIds });
      }
    } else if (action === 'D') {
      this.pool.delete(id);
    }
  }
}
