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
  issueLabels!: Table<DBIssueLabel, string>;
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
  }
}

export const db = new AppDatabase();
