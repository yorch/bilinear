/**
 * Shared frontend types for the issue tracker UI.
 * These mirror the GraphQL types returned by the API — kept intentionally
 * narrow (only the fields the UI actually reads).
 */

export interface WorkflowState {
  id: string;
  name: string;
  color: string;
  type: string;
}

export interface IssueUser {
  id: string;
  displayName: string;
  initials: string;
  avatarUrl?: string | null;
  avatarBackgroundColor: string;
}

export interface IssueLabel {
  id: string;
  name: string;
  color: string;
}

export interface IssueBase {
  id: string;
  identifier: string;
  title: string;
  priority: number;
  stateId: string;
  assigneeId?: string | null;
  dueDate?: string | null;
  labels: IssueLabel[];
}

export interface IssueDetail extends IssueBase {
  description?: string | null;
  createdAt: string;
  updatedAt: string;
}
