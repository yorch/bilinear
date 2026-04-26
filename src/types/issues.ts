/**
 * Shared frontend types for the issue tracker UI.
 * These mirror the GraphQL types returned by the API — kept intentionally
 * narrow (only the fields the UI actually reads).
 */

export interface WorkflowState {
  color: string;
  id: string;
  name: string;
  type: string;
}

export interface IssueUser {
  avatarBackgroundColor: string;
  avatarUrl?: string | null;
  displayName: string;
  id: string;
  initials: string;
}

export interface IssueLabel {
  color: string;
  id: string;
  name: string;
}

export interface IssueBase {
  assigneeId?: string | null;
  dueDate?: string | null;
  id: string;
  identifier: string;
  labels: IssueLabel[];
  priority: number;
  stateId: string;
  title: string;
}

export interface IssueDetail extends IssueBase {
  createdAt: string;
  description?: string | null;
  estimate?: number | null;
  teamId: string;
  updatedAt: string;
}
