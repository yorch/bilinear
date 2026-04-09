import { action, computed, makeObservable, observable } from 'mobx';
import type { DBProject, DBProjectMilestone } from '@/lib/db';

export class ProjectStore {
  pool = new Map<string, DBProject>();
  milestonePool = new Map<string, DBProjectMilestone>();

  constructor() {
    makeObservable(this, {
      all: computed,
      applyMilestoneSyncAction: action,
      applySyncAction: action,
      milestonePool: observable,
      pool: observable,
      upsertMany: action,
      upsertMilestones: action,
    });
  }

  get all(): DBProject[] {
    return Array.from(this.pool.values())
      .filter(p => !p.archivedAt && !p.trashed)
      .sort((a, b) => {
        // Sort by prioritySortOrder desc, then createdAt desc
        if (b.prioritySortOrder !== a.prioritySortOrder) {
          return b.prioritySortOrder - a.prioritySortOrder;
        }
        return (
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );
      });
  }

  findById(id: string): DBProject | null {
    return this.pool.get(id) ?? null;
  }

  findBySlugId(slugId: string): DBProject | null {
    for (const project of this.pool.values()) {
      if (project.slugId === slugId) {
        return project;
      }
    }
    return null;
  }

  getByStatus(statusType: string): DBProject[] {
    return this.all.filter(p => p.statusType === statusType);
  }

  getMilestones(projectId: string): DBProjectMilestone[] {
    return Array.from(this.milestonePool.values())
      .filter(m => m.projectId === projectId && !m.archivedAt)
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }

  findMilestoneById(id: string): DBProjectMilestone | null {
    return this.milestonePool.get(id) ?? null;
  }

  upsertMany(projects: DBProject[]) {
    for (const project of projects) {
      this.pool.set(project.id, project);
    }
  }

  upsertMilestones(milestones: DBProjectMilestone[]) {
    for (const milestone of milestones) {
      this.milestonePool.set(milestone.id, milestone);
    }
  }

  applySyncAction(actionType: string, id: string, data: DBProject | null) {
    if (actionType === 'I' || actionType === 'U') {
      if (data) {
        this.pool.set(id, data);
      }
    } else if (actionType === 'D' || actionType === 'A') {
      this.pool.delete(id);
    }
  }

  applyMilestoneSyncAction(
    actionType: string,
    id: string,
    data: DBProjectMilestone | null,
  ) {
    if (actionType === 'I' || actionType === 'U') {
      if (data) {
        this.milestonePool.set(id, data);
      }
    } else if (actionType === 'D' || actionType === 'A') {
      this.milestonePool.delete(id);
    }
  }
}
