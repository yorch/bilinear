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
  completed: { color: 'text-green-500', label: 'Completed' },
  inProgress: { color: 'text-yellow-500', label: 'In Progress' },
  paused: { color: 'text-orange-500', label: 'Paused' },
  planned: { color: 'text-blue-500', label: 'Planned' },
};

export const PROJECT_HEALTH_CONFIG: Record<string, { label: string; color: string }> = {
  atRisk: { color: 'bg-yellow-500', label: 'At Risk' },
  offTrack: { color: 'bg-red-500', label: 'Off Track' },
  onTrack: { color: 'bg-green-500', label: 'On Track' },
};

export const PROJECT_HEALTH_OPTIONS = [
  { color: 'bg-green-500', label: 'On Track', value: 'onTrack' as const },
  { color: 'bg-yellow-500', label: 'At Risk', value: 'atRisk' as const },
  { color: 'bg-red-500', label: 'Off Track', value: 'offTrack' as const },
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
