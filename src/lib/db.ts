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
  snoozedById?: string | null;
  snoozedUntilAt?: string | null;
  sortOrder: number;
  startDate?: string | null;
  startedAt?: string | null;
  startedTriageAt?: string | null;
  stateId: string;
  teamId: string;
  title: string;
  trashed: boolean;
  triagedAt?: string | null;
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
  organizationId: string;
  required: boolean;
  sortOrder: number;
  /** Null = workspace-scoped (applies to every team in organizationId). */
  teamId: string | null;
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

export interface DBInitiative {
  archivedAt?: string | null;
  canceledAt?: string | null;
  color: string;
  completedAt?: string | null;
  createdAt: string;
  creatorId?: string | null;
  description?: string | null;
  icon?: string | null;
  id: string;
  name: string;
  organizationId: string;
  ownerId?: string | null;
  priority: number;
  prioritySortOrder: number;
  progress: number;
  sortOrder: number;
  startDate?: string | null;
  startDateResolution?: string | null;
  startedAt?: string | null;
  status: string;
  targetDate?: string | null;
  targetDateResolution?: string | null;
  updatedAt: string;
}

export interface DBInitiativeProject {
  createdAt: string;
  id: string;
  initiativeId: string;
  projectId: string;
  sortOrder: number;
}

export interface DBFavorite {
  createdAt: string;
  // Issue | Project | Initiative | CustomView | Cycle | Document | Team
  entityId: string;
  entityType: string;
  id: string;
  organizationId: string;
  sortOrder: number;
  userId: string;
}

export interface DBSyncMetadata {
  key: string;
  value: unknown;
}

export interface DBPendingTransaction {
  createdAt: number;
  id: string;
  mutation: string;
  /**
   * Org and user the transaction was enqueued under. `hydrate()` filters
   * persisted rows to the active session so a sign-out + sign-in (same
   * browser, different account) doesn't replay the previous user's
   * mutations under the new user's auth cookies. Rows from other sessions
   * are deleted on hydrate to keep the table from growing unbounded.
   */
  orgId: string;
  retryCount: number;
  userId: string;
  variables: Record<string, unknown>;
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
  initiatives!: Table<DBInitiative, string>;
  initiativeProjects!: Table<DBInitiativeProject, string>;
  projects!: Table<DBProject, string>;
  projectMilestones!: Table<DBProjectMilestone, string>;
  projectUpdates!: Table<DBProjectUpdate, string>;
  customViews!: Table<DBCustomView, string>;
  notifications!: Table<DBNotification, string>;
  favorites!: Table<DBFavorite, string>;
  pendingTransactions!: Table<DBPendingTransaction, string>;
  syncMetadata!: Table<DBSyncMetadata, string>;

  constructor() {
    // The DB name is the migration boundary: bumping it forces every
    // client to re-bootstrap from the server into a fresh DB and orphans
    // the old one. Pre-launch we use this in lieu of versioned upgrades —
    // edit the schema below freely and bump `-vN` when an existing dev
    // pool would conflict.
    // TODO(pre-launch): once we have real users, switch to `.version(N)`
    // blocks with `.upgrade()` migrations and stop bumping the DB name.
    //
    // v3 (2026-05-21): added `favorites` table; widened
    // `customFieldDefinitions` index to include `organizationId` so
    // workspace-scoped lookups (teamId IS NULL) are indexable.
    super('issue-tracker-v3');
    this.version(1).stores({
      customFieldDefinitions: 'id, teamId, organizationId',
      customFieldValues: 'id, issueId, definitionId, [issueId+definitionId]',
      customViews: 'id, organizationId, teamId, creatorId',
      cycles: 'id, teamId, organizationId',
      documents: 'id, organizationId, teamId, projectId, parentId',
      favorites: 'id, userId, organizationId, [userId+entityType+entityId]',
      initiativeProjects: 'id, initiativeId, projectId, [initiativeId+projectId]',
      initiatives: 'id, organizationId, status, ownerId',
      issueActivities: 'id, issueId',
      issueLabels: 'id, organizationId, teamId, parentId',
      issueRelations: 'id, issueId, relatedIssueId',
      issues: 'id, teamId, stateId, assigneeId, organizationId, identifier, projectId, cycleId',
      issueTemplates: 'id, teamId, creatorId',
      notifications: 'id, userId, organizationId, issueId, read',
      organizations: 'id',
      pendingTransactions: 'id, createdAt, [orgId+userId]',
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
