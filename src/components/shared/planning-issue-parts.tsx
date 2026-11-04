'use client';

import { observer } from 'mobx-react-lite';
import { PriorityIcon } from '@/components/properties/priority-icon';
import { ColorDot } from '@/components/ui/color-dot';
import { UserAvatar } from '@/components/ui/user-avatar';
import type { DBIssue } from '@/lib/db';
import { toIssueUsers } from '@/lib/issue-mappers';
import { useStore } from '@/providers/store-provider';

/** Filled state glyph for an issue row on a project or cycle page. */
export const IssueStateDot = observer(function IssueStateDot({ stateId }: { stateId: string }) {
  const { workflowStateStore } = useStore();
  const state = workflowStateStore.findById(stateId);
  if (!state) {
    return null;
  }
  return (
    <span title={state.name}>
      <ColorDot color={state.color} size="md" />
    </span>
  );
});

/** Trailing priority + assignee cells, fixed-width so rows line up. */
export const IssueTrailing = observer(function IssueTrailing({ issue }: { issue: DBIssue }) {
  const { userStore } = useStore();
  const assignee = issue.assigneeId ? userStore.findById(issue.assigneeId) : null;
  return (
    <>
      <span className="flex w-4 shrink-0 justify-center">
        <PriorityIcon priority={issue.priority} />
      </span>
      <span className="flex w-5 shrink-0 justify-end" title={assignee?.displayName}>
        {assignee && <UserAvatar size="sm" user={toIssueUsers([assignee])[0]} />}
      </span>
    </>
  );
});
