import { gql } from '@/lib/graphql';

/** `extensions.reason` the server sets when another user already decided the issue. */
export const TRIAGE_STALE_REASON = 'TRIAGE_STALE';

/**
 * The issue is no longer where this client thought it was: someone else
 * accepted / declined / reverted it first. Callers must NOT roll back to their
 * pre-action snapshot (that would resurrect a decided issue); they re-read the
 * server's state instead.
 */
export class TriageStaleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TriageStaleError';
  }
}

export const TRIAGE_ACCEPT_MUTATION = `
  mutation TriageAccept($issueId: ID!, $input: IssueTriageAcceptInput!) {
    issueTriageAccept(issueId: $issueId, input: $input) {
      success
      lastSyncId
      issue { id stateId triagedAt }
    }
  }
`;

export const TRIAGE_DECLINE_MUTATION = `
  mutation TriageDecline($issueId: ID!) {
    issueTriageDecline(issueId: $issueId) {
      success
      lastSyncId
      issue { id stateId canceledAt triagedAt }
    }
  }
`;

export const TRIAGE_MARK_DUPLICATE_MUTATION = `
  mutation TriageMarkDuplicate($issueId: ID!, $canonicalIssueId: ID!) {
    issueTriageMarkDuplicate(issueId: $issueId, canonicalIssueId: $canonicalIssueId) {
      success
      lastSyncId
      issue { id stateId canceledAt triagedAt }
    }
  }
`;

export const TRIAGE_SNOOZE_MUTATION = `
  mutation TriageSnooze($issueId: ID!, $until: DateTime!) {
    issueTriageSnooze(issueId: $issueId, until: $until) {
      success
      lastSyncId
      issue { id snoozedUntilAt }
    }
  }
`;

export const TRIAGE_REVERT_MUTATION = `
  mutation TriageRevert($issueId: ID!) {
    issueTriageRevert(issueId: $issueId) {
      success
      lastSyncId
      issue { id stateId canceledAt triagedAt snoozedUntilAt }
    }
  }
`;

export const TRIAGE_ISSUE_STATE_QUERY = `
  query TriageIssueState($id: ID!) {
    issue(id: $id) { id stateId canceledAt triagedAt snoozedUntilAt }
  }
`;

/**
 * Run a triage mutation. Throws `TriageStaleError` for a lost race and a plain
 * `Error` (server message, else `fallback`) for everything else.
 */
export async function triageMutate(
  query: string,
  variables: Record<string, unknown>,
  fallback: string,
): Promise<void> {
  const res = await gql(query, variables);
  if (res.errors?.length) {
    const first = res.errors[0] as { extensions?: { reason?: string }; message?: string };
    if (first?.extensions?.reason === TRIAGE_STALE_REASON) {
      throw new TriageStaleError(first.message ?? fallback);
    }
    throw new Error(first?.message ?? fallback);
  }
}

export interface ServerIssueState {
  canceledAt: string | null;
  id: string;
  snoozedUntilAt: string | null;
  stateId: string;
  triagedAt: string | null;
}

/** The server's current lifecycle fields for one issue, or null if unreadable. */
export async function fetchIssueState(id: string): Promise<ServerIssueState | null> {
  try {
    const res = await gql(TRIAGE_ISSUE_STATE_QUERY, { id });
    if (res.errors?.length) {
      return null;
    }
    return ((res.data as { issue?: ServerIssueState } | undefined)?.issue ??
      null) as ServerIssueState | null;
  } catch {
    return null;
  }
}
