import type { DBIssueLabel, DBUser } from '@/lib/db';
import type { IssueLabel, IssueUser } from '@/types/issues';

/**
 * Store-model → view-model mappers shared by every page that feeds users and
 * labels into the issue components (previously copy-pasted per page).
 */
export function toIssueUsers(users: DBUser[]): IssueUser[] {
  return users.map(u => ({
    avatarBackgroundColor: u.avatarBgColor,
    avatarUrl: u.avatarUrl ?? null,
    displayName: u.displayName,
    id: u.id,
    initials: u.initials,
  }));
}

export function toIssueLabels(labels: DBIssueLabel[]): IssueLabel[] {
  return labels.map(l => ({
    color: l.color,
    id: l.id,
    name: l.name,
  }));
}
