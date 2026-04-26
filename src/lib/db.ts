import Dexie, { type Table } from 'dexie';

// ─── Entity types stored in IndexedDB ────────────────────────────────────────
// These are plain objects (no Prisma relations — just scalar fields + FKs).

export interface DBOrganization {
  archivedAt?: string | null;
  createdAt: string;
  dataRegion: string;
  id: string;
  logoUrl?: string | null;
  name: string;
  roadmapEnabled: boolean;
  updatedAt: string;
  urlKey: string;
}

export interface DBUser {
  active: boolean;
  avatarBgColor: string;
  avatarUrl?: string | null;
  createdAt: string;
  displayName: string;
  email: string;
  id: string;
  initials: string;
  lastSeen?: string | null;
  name: string;
  statusEmoji?: string | null;
  statusLabel?: string | null;
  timezone?: string | null;
  updatedAt: string;
}

export interface DBTeam {
  archivedAt?: string | null;
  color?: string | null;
  createdAt: string;
  cyclesEnabled: boolean;
  description?: string | null;
  displayName: string;
  icon?: string | null;
  id: string;
  issueCount: number;
  issueEstimationType: string;
  key: string;
  name: string;
  organizationId: string;
  parentId?: string | null;
  private: boolean;
  timezone: string;
  triageEnabled: boolean;
  updatedAt: string;
}

export interface DBWorkflowState {
  archivedAt?: string | null;
  color: string;
  createdAt: string;
  description?: string | null;
  id: string;
  name: string;
  position: number;
  teamId: string;
  type: string;
  updatedAt: string;
}

export interface DBIssue {
  archivedAt?: string | null;
  assigneeId?: string | null;
  branchName?: string | null;
  canceledAt?: string | null;
  completedAt?: string | null;
  createdAt: string;
  creatorId?: string | null;
  cycleId?: string | null;
  description?: string | null;
  dueDate?: string | null;
  estimate?: number | null;
  id: string;
  identifier: string;
  labelIds: string[];
  number: number;
  organizationId: string;
  parentId?: string | null;
  priority: number;
  prioritySortOrder: number;
  projectId?: string | null;
  sortOrder: number;
  startedAt?: string | null;
  stateId: string;
  teamId: string;
  title: string;
  trashed: boolean;
  updatedAt: string;
}

export interface DBIssueLabel {
  archivedAt?: string | null;
  color: string;
  createdAt: string;
  creatorId?: string | null;
  description?: string | null;
  id: string;
  isGroup: boolean;
  name: string;
  organizationId: string;
  parentId?: string | null;
  teamId?: string | null;
  updatedAt: string;
}

export interface DBProject {
  archivedAt?: string | null;
  canceledAt?: string | null;
  color: string;
  completedAt?: string | null;
  content?: string | null;
  createdAt: string;
  creatorId?: string | null;
  description: string;
  health?: string | null;
  healthUpdatedAt?: string | null;
  icon?: string | null;
  id: string;
  leadId?: string | null;
  name: string;
  organizationId: string;
  priority: number;
  prioritySortOrder: number;
  progress: number;
  roadmapVisible: boolean;
  scope: number;
  slugId: string;
  startDate?: string | null;
  startDateResolution?: string | null;
  startedAt?: string | null;
  statusName?: string | null;
  statusType: string;
  targetDate?: string | null;
  targetDateResolution?: string | null;
  trashed: boolean;
  updatedAt: string;
}

export interface DBProjectMilestone {
  archivedAt?: string | null;
  createdAt: string;
  description?: string | null;
  id: string;
  name: string;
  projectId: string;
  sortOrder: number;
  targetDate?: string | null;
  updatedAt: string;
}

export interface DBProjectUpdate {
  body: string;
  createdAt: string;
  editedAt?: string | null;
  health?: string | null;
  id: string;
  projectId: string;
  updatedAt: string;
  userId: string;
}

export interface DBCycle {
  archivedAt?: string | null;
  completedAt?: string | null;
  createdAt: string;
  description?: string | null;
  endsAt: string;
  id: string;
  name?: string | null;
  number: number;
  organizationId: string;
  progress: number;
  scope: number;
  startsAt: string;
  teamId: string;
  updatedAt: string;
}

export interface DBCustomView {
  archivedAt?: string | null;
  color?: string | null;
  createdAt: string;
  creatorId: string;
  description?: string | null;
  filters: object;
  groupBy?: string | null;
  icon?: string | null;
  id: string;
  layout: string;
  name: string;
  organizationId: string;
  shared: boolean;
  sort: object;
  sortOrder: number;
  teamId?: string | null;
  updatedAt: string;
}

export interface DBNotification {
  actorId?: string | null;
  createdAt: string;
  data: object;
  id: string;
  issueId?: string | null;
  organizationId: string;
  read: boolean;
  readAt?: string | null;
  snoozedUntilAt?: string | null;
  type: string;
  updatedAt: string;
  userId: string;
}

export interface DBIssueActivity {
  actorId?: string | null;
  createdAt: string;
  field: string;
  id: string;
  issueId: string;
  newValue?: string | null;
  oldValue?: string | null;
}

export interface DBIssueRelation {
  createdAt: string;
  id: string;
  issueId: string;
  relatedIssueId: string;
  type: string;
}

export interface DBIssueTemplate {
  archivedAt?: string | null;
  createdAt: string;
  creatorId?: string | null;
  description?: string | null;
  id: string;
  isDefault: boolean;
  name: string;
  teamId: string;
  templateData: object;
  updatedAt: string;
}

export interface DBCustomFieldDefinition {
  archivedAt?: string | null;
  createdAt: string;
  description?: string | null;
  id: string;
  name: string;
  options?: Array<{ value: string; label: string; color?: string }> | null;
  required: boolean;
  sortOrder: number;
  teamId: string;
  type: 'text' | 'number' | 'date' | 'select' | 'multi_select' | 'url' | 'checkbox';
  updatedAt: string;
}

export interface DBCustomFieldValue {
  createdAt: string;
  definitionId: string;
  id: string;
  issueId: string;
  updatedAt: string;
  value: unknown;
}

export interface DBDocument {
  archivedAt?: string | null;
  content?: string | null;
  createdAt: string;
  creatorId?: string | null;
  icon?: string | null;
  id: string;
  organizationId: string;
  parentId?: string | null;
  projectId?: string | null;
  sortOrder: number;
  teamId?: string | null;
  title: string;
  updatedAt: string;
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
      issues: 'id, teamId, stateId, assigneeId, organizationId, identifier, projectId',
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
      issues: 'id, teamId, stateId, assigneeId, organizationId, identifier, projectId',
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
      issues: 'id, teamId, stateId, assigneeId, organizationId, identifier, projectId, cycleId',
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
      issues: 'id, teamId, stateId, assigneeId, organizationId, identifier, projectId, cycleId',
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
      issues: 'id, teamId, stateId, assigneeId, organizationId, identifier, projectId, cycleId',
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
      issues: 'id, teamId, stateId, assigneeId, organizationId, identifier, projectId, cycleId',
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
    this.version(8)
      .stores({
        customFieldDefinitions: 'id, teamId',
        customFieldValues: 'id, issueId, definitionId, [issueId+definitionId]',
        customViews: 'id, organizationId, teamId, creatorId',
        cycles: 'id, teamId, organizationId',
        documents: 'id, organizationId, teamId, projectId, parentId',
        issueActivities: 'id, issueId',
        issueLabels: 'id, organizationId, teamId, parentId',
        issueRelations: 'id, issueId, relatedIssueId',
        issues: 'id, teamId, stateId, assigneeId, organizationId, identifier, projectId, cycleId',
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
      })
      // Any user upgrading from v1-v7 carries rows that may be missing new
      // fields (`cycleId`, `projectId`, custom fields, …). Rather than
      // write a migration per version, wipe the cache on the first upgrade
      // to v8 — SyncManager sees an empty pool, falls through to
      // fullBootstrap, and refills from the server. Future schema bumps
      // should attach a similar `.upgrade()` (or bump the DB name).
      .upgrade(async tx => {
        for (const table of tx.db.tables) {
          await tx.table(table.name).clear();
        }
      });
  }
}

export const db = new AppDatabase();
