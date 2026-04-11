import { action, computed, makeObservable, observable } from 'mobx';
import type { DBIssueTemplate } from '@/lib/db';

export class IssueTemplateStore {
  pool = new Map<string, DBIssueTemplate>();

  constructor() {
    makeObservable(this, {
      all: computed,
      applySyncAction: action,
      optimisticUpdate: action,
      pool: observable,
      upsertMany: action,
    });
  }

  get all(): DBIssueTemplate[] {
    return Array.from(this.pool.values())
      .filter(t => !t.archivedAt)
      .sort((a, b) => {
        if (b.isDefault !== a.isDefault) {
          return b.isDefault ? 1 : -1;
        }
        return a.name.localeCompare(b.name);
      });
  }

  findById(id: string): DBIssueTemplate | null {
    return this.pool.get(id) ?? null;
  }

  findByTeamId(teamId: string): DBIssueTemplate[] {
    return this.all.filter(t => t.teamId === teamId);
  }

  getDefaultForTeam(teamId: string): DBIssueTemplate | null {
    return this.findByTeamId(teamId).find(t => t.isDefault) ?? null;
  }

  upsertMany(templates: DBIssueTemplate[]) {
    for (const template of templates) {
      this.pool.set(template.id, template);
    }
  }

  optimisticUpdate(id: string, patch: Partial<DBIssueTemplate>) {
    const existing = this.pool.get(id);
    if (existing) {
      this.pool.set(id, { ...existing, ...patch });
    }
  }

  applySyncAction(
    actionType: string,
    id: string,
    data: DBIssueTemplate | null,
  ) {
    if (actionType === 'I' || actionType === 'U' || actionType === 'A') {
      if (data) {
        this.pool.set(id, data);
      }
    } else if (actionType === 'D') {
      this.pool.delete(id);
    }
  }
}
