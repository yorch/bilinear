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
  updatedAt: string;
  urlKey: string;
}

/**
 * A row of `organization_members`: who is in this workspace and as what.
 *
 * Deliberately separate from `DBUser`. A User row is never deleted when
 * someone is removed from an org, so "is this person still a member" can only
 * be answered by the membership's presence — which is what makes the roster
 * reactive to a `'D' OrganizationMember` SyncAction instead of stale until
 * reload.
 */
export interface DBOrganizationMember {
  createdAt: string;
  id: string;
  organizationId: string;
  role: string;
  updatedAt: string;
  userId: string;
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

/**
 * An issue row as it arrives from a server, before `normalizeIssueRow` collapses
 * it. Every writer of issue state — the SyncAction stream, GraphQL mutation
 * responses, and bootstrap — sends one of three mutually exclusive label shapes,
 * and `labelIds` is absent on two of them. `DBIssue` is the *normalized* form and
 * declares `labelIds` as required, so typing these inputs as `DBIssue` was a lie
 * that every call site had to cast its way around.
 */
export type IssueSyncRow = Omit<DBIssue, 'labelIds'> & {
  /** Prisma relation shape, on SyncAction payloads. */
  labelAssignments?: Array<{ labelId: string }>;
  /** Already-normalized shape, from bootstrap. */
  labelIds?: string[];
  /** GraphQL mutation-response shape. */
  labels?: Array<{ id: string }>;
};

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
  roadmapVisible: boolean;
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
  parentId?: string | null;
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
  organizationMembers!: Table<DBOrganizationMember, string>;
  users!: Table<DBUser, string>;
  teams!: Table<DBTeam, string>;
  workflowStates!: Table<DBWorkflowState, string>;
  issues!: Table<DBIssue, string>;
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
    // Named for the product, with no version suffix.
    //
    // It used to be `issue-tracker-vN`, where the name doubled as the
    // migration boundary: bumping it forced every client to re-bootstrap into
    // a fresh DB and orphaned the old one. That worked as a stand-in for
    // versioned upgrades while nothing was deployed, but it conflates two
    // things — *what this database is* and *which schema generation it holds*
    // — and only the second is supposed to change.
    //
    // Nothing is deployed, so there is no client whose data the rename could
    // strand: the only cost is that dev browsers holding `issue-tracker-v4`
    // re-bootstrap once and leave that database orphaned. Clear it by hand if
    // you care (devtools › Application › IndexedDB).
    //
    // TODO(pre-launch): the schema below is still a single `.version(1)`
    // block, edited in place. That is deliberate while nothing is deployed —
    // the same reasoning as the migration-consolidation policy in
    // DATABASE_SCHEMA.md: a version generation only earns its keep once there
    // is a real client whose data has to survive the change. Editing v1 costs
    // a dev browser one re-bootstrap, and a *removed* table leaves an orphaned
    // object store behind until that browser clears the database.
    //
    // Before the first real deployment this must become `.version(N)` +
    // `.upgrade()`, and the database name must then stay fixed — renaming it
    // to force a fresh database would silently discard a real user's offline
    // queue (`pendingTransactions` is the one thing in here that exists
    // nowhere else).
    //
    // Adding a *synced* collection additionally needs `CACHED_COLLECTIONS`
    // updated, whichever scheme is in force. That half is already built: a
    // Dexie upgrade creates a newly added table empty, the cache still looks
    // usable, and the delta path only carries rows that changed — so without
    // the stamp the new table would never backfill. See that constant.
    super('bilinear');
    this.version(1).stores({
      customFieldDefinitions: 'id, teamId, organizationId',
      customFieldValues: 'id, issueId, definitionId, [issueId+definitionId]',
      customViews: 'id, organizationId, teamId, creatorId',
      cycles: 'id, teamId, organizationId',
      documents: 'id, organizationId, teamId, projectId, parentId',
      favorites: 'id, userId, organizationId, [userId+entityType+entityId]',
      initiativeProjects: 'id, initiativeId, projectId, [initiativeId+projectId]',
      initiatives: 'id, organizationId, status, ownerId',
      issueLabels: 'id, organizationId, teamId, parentId',
      issueRelations: 'id, issueId, relatedIssueId',
      issues: 'id, teamId, stateId, assigneeId, organizationId, identifier, projectId, cycleId',
      issueTemplates: 'id, teamId, creatorId',
      notifications: 'id, userId, organizationId, issueId, read',
      organizationMembers: 'id, organizationId, userId, [organizationId+userId]',
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
