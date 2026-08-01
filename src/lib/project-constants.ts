export type ProjectStatusType =
  | 'backlog'
  | 'planned'
  | 'inProgress'
  | 'paused'
  | 'completed'
  | 'canceled';

export type ProjectHealth = 'onTrack' | 'atRisk' | 'offTrack';

export const PROJECT_STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  backlog: { color: 'text-muted-foreground', label: 'Backlog' },
  canceled: { color: 'text-muted-foreground', label: 'Canceled' },
  completed: { color: 'text-success-subtle-foreground', label: 'Completed' },
  // In Progress is active work, not a warning — it takes the accent, matching
  // the in-progress workflow state elsewhere. (The status-token migration
  // mapped its original yellow onto the same warning role as `paused`, which
  // made the two states indistinguishable.)
  inProgress: { color: 'text-brand', label: 'In Progress' },
  paused: { color: 'text-warning-subtle-foreground', label: 'Paused' },
  planned: { color: 'text-info-subtle-foreground', label: 'Planned' },
};

export const PROJECT_HEALTH_CONFIG: Record<string, { label: string; color: string }> = {
  atRisk: { color: 'bg-warning', label: 'At Risk' },
  offTrack: { color: 'bg-danger', label: 'Off Track' },
  onTrack: { color: 'bg-success', label: 'On Track' },
};

export const PROJECT_HEALTH_OPTIONS = [
  { color: 'bg-success', label: 'On Track', value: 'onTrack' as const },
  { color: 'bg-warning', label: 'At Risk', value: 'atRisk' as const },
  { color: 'bg-danger', label: 'Off Track', value: 'offTrack' as const },
];

/** Maps project status values to i18n keys under `projects.status.*`. */
export const PROJECT_STATUS_LABEL_KEYS: Record<string, string> = {
  backlog: 'projects.status.backlog',
  canceled: 'projects.status.canceled',
  completed: 'projects.status.completed',
  inProgress: 'projects.status.inProgress',
  paused: 'projects.status.paused',
  planned: 'projects.status.planned',
};

/** Maps project health values to i18n keys under `properties.updateForm.health.*`. */
export const PROJECT_HEALTH_LABEL_KEYS: Record<string, string> = {
  atRisk: 'properties.updateForm.health.atRisk',
  offTrack: 'properties.updateForm.health.offTrack',
  onTrack: 'properties.updateForm.health.onTrack',
};

/**
 * Client-side mirror of `ProjectService.getProgress`: completed / total over a
 * project's live issues. `issueStore.findByProjectId` already applies the same
 * `!trashed && !archivedAt` filter the server uses.
 *
 * The `Project.progress` column exists but nothing ever writes it — the server
 * computes progress on read — so anything rendering the stored value showed 0%
 * for every project.
 */
export function computeProjectProgress(issues: { completedAt?: string | null }[]): number {
  if (issues.length === 0) {
    return 0;
  }
  return issues.filter(i => i.completedAt).length / issues.length;
}
