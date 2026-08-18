import { action, computed, makeObservable, observable } from 'mobx';
import type { DBProject, DBProjectMilestone, DBProjectUpdate } from '@/lib/db';
import { applyPoolSyncAction } from './apply-pool-sync-action';

export class ProjectStore {
  pool = new Map<string, DBProject>();
  milestonePool = new Map<string, DBProjectMilestone>();
  updatePool = new Map<string, DBProjectUpdate>();

  constructor() {
    makeObservable(this, {
      all: computed,
      applyMilestoneSyncAction: action,
      applySyncAction: action,
      applyUpdateSyncAction: action,
      milestonePool: observable,
      pool: observable,
      updatePool: observable,
      upsertMany: action,
      upsertMilestones: action,
      upsertUpdates: action,
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
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
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

  upsertUpdates(updates: DBProjectUpdate[]) {
    for (const update of updates) {
      this.updatePool.set(update.id, update);
    }
  }

  getUpdates(projectId: string): DBProjectUpdate[] {
    return Array.from(this.updatePool.values())
      .filter(u => u.projectId === projectId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  applySyncAction(actionType: string, id: string, data: DBProject | null) {
    applyPoolSyncAction(this.pool, actionType, id, data);
  }

  applyMilestoneSyncAction(actionType: string, id: string, data: DBProjectMilestone | null) {
    applyPoolSyncAction(this.milestonePool, actionType, id, data);
  }

  applyUpdateSyncAction(actionType: string, id: string, data: DBProjectUpdate | null) {
    applyPoolSyncAction(this.updatePool, actionType, id, data);
  }
}
