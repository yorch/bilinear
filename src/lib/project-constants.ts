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

/**
 * `color` is the vivid fill, and is only ever correct for a shape that carries
 * no text — the status dot in the project list. Anything with a label on it
 * uses `tone`, which resolves to the Badge subtle-fill/subtle-ink pair that
 * `src/lib/contrast.test.ts` asserts at 4.5:1. White on the vivid fills does
 * not clear that: white on `--warning` is ~2.6:1 in light and ~1.4:1 in dark,
 * because an amber light enough to read as "warning" cannot carry white text.
 */
export const PROJECT_HEALTH_CONFIG: Record<
  string,
  { label: string; color: string; tone: 'warning' | 'danger' | 'success' }
> = {
  atRisk: { color: 'bg-warning', label: 'At Risk', tone: 'warning' },
  offTrack: { color: 'bg-danger', label: 'Off Track', tone: 'danger' },
  onTrack: { color: 'bg-success', label: 'On Track', tone: 'success' },
};

export const PROJECT_HEALTH_OPTIONS = [
  { color: 'bg-success', label: 'On Track', tone: 'success', value: 'onTrack' as const },
  { color: 'bg-warning', label: 'At Risk', tone: 'warning', value: 'atRisk' as const },
  { color: 'bg-danger', label: 'Off Track', tone: 'danger', value: 'offTrack' as const },
];

/**
 * Selected-state classes for a health option button. The selection reads from
 * the ring rather than from a vivid fill, so the label keeps its asserted
 * contrast against the subtle tint underneath it.
 */
export const PROJECT_HEALTH_SELECTED_CLASSES: Record<string, string> = {
  atRisk: 'bg-warning-subtle text-warning-subtle-foreground ring-1 ring-warning',
  offTrack: 'bg-danger-subtle text-danger-subtle-foreground ring-1 ring-danger',
  onTrack: 'bg-success-subtle text-success-subtle-foreground ring-1 ring-success',
};

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
