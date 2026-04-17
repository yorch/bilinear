import Dexie, { type Table } from 'dexie';

// ─── Entity types stored in IndexedDB ────────────────────────────────────────
// These are plain objects (no Prisma relations — just scalar fields + FKs).

export interface DBOrganization {
  id: string;
  name: string;
  urlKey: string;
  logoUrl?: string | null;
  dataRegion: string;
  roadmapEnabled: boolean;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string | null;
}

export interface DBUser {
  id: string;
  name: string;
  displayName: string;
  email: string;
  initials: string;
  avatarUrl?: string | null;
  avatarBgColor: string;
  active: boolean;
  lastSeen?: string | null;
  timezone?: string | null;
  statusEmoji?: string | null;
  statusLabel?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DBTeam {
  id: string;
  organizationId: string;
  name: string;
  key: string;
  displayName: string;
  description?: string | null;
  icon?: string | null;
  color?: string | null;
  private: boolean;
  timezone: string;
  cyclesEnabled: boolean;
  issueEstimationType: string;
  triageEnabled: boolean;
  issueCount: number;
  parentId?: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string | null;
}

export interface DBWorkflowState {
  id: string;
  teamId: string;
  name: string;
  color: string;
  description?: string | null;
  type: string;
  position: number;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string | null;
}

export interface DBIssue {
  id: string;
  organizationId: string;
  teamId: string;
  number: number;
  identifier: string;
  title: string;
  description?: string | null;
  priority: number;
  estimate?: number | null;
  dueDate?: string | null;
  sortOrder: number;
  prioritySortOrder: number;
  stateId: string;
  assigneeId?: string | null;
  creatorId?: string | null;
  parentId?: string | null;
  projectId?: string | null;
  cycleId?: string | null;
  branchName?: string | null;
  trashed: boolean;
  labelIds: string[];
  startedAt?: string | null;
  completedAt?: string | null;
  canceledAt?: string | null;
  archivedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DBIssueLabel {
  id: string;
  organizationId: string;
  teamId?: string | null;
  name: string;
  color: string;
  description?: string | null;
  isGroup: boolean;
  parentId?: string | null;
  creatorId?: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string | null;
}

export interface DBProject {
  id: string;
  organizationId: string;
  name: string;
  slugId: string;
  description: string;
  content?: string | null;
  icon?: string | null;
  color: string;
  statusType: string;
  statusName?: string | null;
  health?: string | null;
  healthUpdatedAt?: string | null;
  priority: number;
  prioritySortOrder: number;
  progress: number;
  scope: number;
  startDate?: string | null;
  targetDate?: string | null;
  startDateResolution?: string | null;
  targetDateResolution?: string | null;
  leadId?: string | null;
  creatorId?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  canceledAt?: string | null;
  trashed: boolean;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string | null;
}

export interface DBProjectMilestone {
  id: string;
  projectId: string;
  name: string;
  description?: string | null;
  targetDate?: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string | null;
}

export interface DBProjectUpdate {
  id: string;
  projectId: string;
  userId: string;
  body: string;
  health?: string | null;
  editedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DBCycle {
  id: string;
  organizationId: string;
  teamId: string;
  number: number;
  name?: string | null;
  description?: string | null;
  startsAt: string;
  endsAt: string;
  completedAt?: string | null;
  progress: number;
  scope: number;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string | null;
}

export interface DBCustomView {
  id: string;
  organizationId: string;
  teamId?: string | null;
  creatorId: string;
  name: string;
  description?: string | null;
  icon?: string | null;
  color?: string | null;
  filters: object;
  sort: object;
  groupBy?: string | null;
  layout: string;
  shared: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string | null;
}

export interface DBNotification {
  id: string;
  organizationId: string;
  userId: string;
  issueId?: string | null;
  actorId?: string | null;
  type: string;
  data: object;
  read: boolean;
  readAt?: string | null;
  snoozedUntilAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DBIssueActivity {
  id: string;
  issueId: string;
  actorId?: string | null;
  field: string;
  oldValue?: string | null;
  newValue?: string | null;
  createdAt: string;
}

export interface DBIssueRelation {
  id: string;
  issueId: string;
  relatedIssueId: string;
  type: string;
  createdAt: string;
}

export interface DBIssueTemplate {
  id: string;
  teamId: string;
  creatorId?: string | null;
  name: string;
  description?: string | null;
  templateData: object;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string | null;
}

export interface DBCustomFieldDefinition {
  id: string;
  teamId: string;
  name: string;
  type:
    | 'text'
    | 'number'
    | 'date'
    | 'select'
    | 'multi_select'
    | 'url'
    | 'checkbox';
  description?: string | null;
  required: boolean;
  options?: Array<{ value: string; label: string; color?: string }> | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string | null;
}

export interface DBCustomFieldValue {
  id: string;
  issueId: string;
  definitionId: string;
  value: unknown;
  createdAt: string;
  updatedAt: string;
}

export interface DBDocument {
  id: string;
  organizationId: string;
  teamId?: string | null;
  projectId?: string | null;
  creatorId?: string | null;
  parentId?: string | null;
  title: string;
  content?: string | null;
  icon?: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string | null;
}

export interface DBSyncMetadata {
  key: string;
  value: unknown;
}

// ─── Dexie database ───────────────────────────────────────────────────────────

export class AppDatabase extends Dexie {
  organizations!: Table<DBOrganization, string>;
  users!: Table<DBUser, string>;
  teams!: Table<DBTeam, string>;
  workflowStates!: Table<DBWorkflowState, string>;
  issues!: Table<DBIssue, string>;
  issueActivities!: Table<DBIssueActivity, string>;
  issueLabels!: Table<DBIssueLabel, string>;
  issueRelations!: Table<DBIssueRelation, string>;
  issueTemplates!: Table<DBIssueTemplate, string>;
  customFieldDefinitions!: Table<DBCustomFieldDefinition, string>;
  customFieldValues!: Table<DBCustomFieldValue, string>;
  cycles!: Table<DBCycle, string>;
  documents!: Table<DBDocument, string>;
  projects!: Table<DBProject, string>;
  projectMilestones!: Table<DBProjectMilestone, string>;
  projectUpdates!: Table<DBProjectUpdate, string>;
  customViews!: Table<DBCustomView, string>;
  notifications!: Table<DBNotification, string>;
  syncMetadata!: Table<DBSyncMetadata, string>;

  constructor() {
    super('issue-tracker-v1');
    this.version(1).stores({
      issueLabels: 'id, organizationId, teamId, parentId',
      issues: 'id, teamId, stateId, assigneeId, organizationId, identifier',
      organizations: 'id',
      syncMetadata: 'key',
      teams: 'id, organizationId, parentId',
      users: 'id, email',
      workflowStates: 'id, teamId',
    });
    this.version(2).stores({
      issueLabels: 'id, organizationId, teamId, parentId',
      issues:
        'id, teamId, stateId, assigneeId, organizationId, identifier, projectId',
      organizations: 'id',
      projectMilestones: 'id, projectId',
      projects: 'id, organizationId, statusType, leadId',
      syncMetadata: 'key',
      teams: 'id, organizationId, parentId',
      users: 'id, email',
      workflowStates: 'id, teamId',
    });
    this.version(3).stores({
      issueLabels: 'id, organizationId, teamId, parentId',
      issues:
        'id, teamId, stateId, assigneeId, organizationId, identifier, projectId',
      organizations: 'id',
      projectMilestones: 'id, projectId',
      projects: 'id, organizationId, statusType, leadId',
      projectUpdates: 'id, projectId, userId',
      syncMetadata: 'key',
      teams: 'id, organizationId, parentId',
      users: 'id, email',
      workflowStates: 'id, teamId',
    });
    this.version(4).stores({
      cycles: 'id, teamId, organizationId',
      issueLabels: 'id, organizationId, teamId, parentId',
      issues:
        'id, teamId, stateId, assigneeId, organizationId, identifier, projectId, cycleId',
      organizations: 'id',
      projectMilestones: 'id, projectId',
      projects: 'id, organizationId, statusType, leadId',
      projectUpdates: 'id, projectId, userId',
      syncMetadata: 'key',
      teams: 'id, organizationId, parentId',
      users: 'id, email',
      workflowStates: 'id, teamId',
    });
    this.version(5).stores({
      customViews: 'id, organizationId, teamId, creatorId',
      cycles: 'id, teamId, organizationId',
      issueLabels: 'id, organizationId, teamId, parentId',
      issues:
        'id, teamId, stateId, assigneeId, organizationId, identifier, projectId, cycleId',
      organizations: 'id',
      projectMilestones: 'id, projectId',
      projects: 'id, organizationId, statusType, leadId',
      projectUpdates: 'id, projectId, userId',
      syncMetadata: 'key',
      teams: 'id, organizationId, parentId',
      users: 'id, email',
      workflowStates: 'id, teamId',
    });
    this.version(6).stores({
      customViews: 'id, organizationId, teamId, creatorId',
      cycles: 'id, teamId, organizationId',
      issueActivities: 'id, issueId',
      issueLabels: 'id, organizationId, teamId, parentId',
      issueRelations: 'id, issueId, relatedIssueId',
      issues:
        'id, teamId, stateId, assigneeId, organizationId, identifier, projectId, cycleId',
      issueTemplates: 'id, teamId, creatorId',
      notifications: 'id, userId, organizationId, issueId, read',
      organizations: 'id',
      projectMilestones: 'id, projectId',
      projects: 'id, organizationId, statusType, leadId',
      projectUpdates: 'id, projectId, userId',
      syncMetadata: 'key',
      teams: 'id, organizationId, parentId',
      users: 'id, email',
      workflowStates: 'id, teamId',
    });
    this.version(7).stores({
      customFieldDefinitions: 'id, teamId',
      customFieldValues: 'id, issueId, definitionId, [issueId+definitionId]',
      customViews: 'id, organizationId, teamId, creatorId',
      cycles: 'id, teamId, organizationId',
      issueActivities: 'id, issueId',
      issueLabels: 'id, organizationId, teamId, parentId',
      issueRelations: 'id, issueId, relatedIssueId',
      issues:
        'id, teamId, stateId, assigneeId, organizationId, identifier, projectId, cycleId',
      issueTemplates: 'id, teamId, creatorId',
      notifications: 'id, userId, organizationId, issueId, read',
      organizations: 'id',
      projectMilestones: 'id, projectId',
      projects: 'id, organizationId, statusType, leadId',
      projectUpdates: 'id, projectId, userId',
      syncMetadata: 'key',
      teams: 'id, organizationId, parentId',
      users: 'id, email',
      workflowStates: 'id, teamId',
    });
    this.version(8).stores({
      customFieldDefinitions: 'id, teamId',
      customFieldValues: 'id, issueId, definitionId, [issueId+definitionId]',
      customViews: 'id, organizationId, teamId, creatorId',
      cycles: 'id, teamId, organizationId',
      documents: 'id, organizationId, teamId, projectId, parentId',
      issueActivities: 'id, issueId',
      issueLabels: 'id, organizationId, teamId, parentId',
      issueRelations: 'id, issueId, relatedIssueId',
      issues:
        'id, teamId, stateId, assigneeId, organizationId, identifier, projectId, cycleId',
      issueTemplates: 'id, teamId, creatorId',
      notifications: 'id, userId, organizationId, issueId, read',
      organizations: 'id',
      projectMilestones: 'id, projectId',
      projects: 'id, organizationId, statusType, leadId',
      projectUpdates: 'id, projectId, userId',
      syncMetadata: 'key',
      teams: 'id, organizationId, parentId',
      users: 'id, email',
      workflowStates: 'id, teamId',
    });
  }
}

export const db = new AppDatabase();
