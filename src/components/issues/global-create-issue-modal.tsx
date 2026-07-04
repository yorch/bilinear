'use client';

import { observer } from 'mobx-react-lite';
import { useParams } from 'next/navigation';
import { CreateIssueModal } from '@/components/issues/create-issue-modal';
import { useIssueCreate } from '@/hooks/use-issue-create';
import { useStore } from '@/providers/store-provider';
import type { IssueLabel, IssueUser } from '@/types/issues';

/**
 * Workspace-wide create-issue modal driven by `uiStore.createIssueModalOpen`
 * (opened by the global `C` shortcut and the command palette's Create Issue
 * action). Targets the team from the current route when on a team page,
 * otherwise the first team in the workspace.
 */
export const GlobalCreateIssueModal = observer(function GlobalCreateIssueModal() {
  const { uiStore, teamStore, workflowStateStore, userStore, labelStore } = useStore();
  const params = useParams<{ workspace?: string; key?: string }>();

  const routeTeam = params.key ? teamStore.findByKey(params.key) : null;
  const team = routeTeam ?? teamStore.all[0] ?? null;
  const states = team ? workflowStateStore.findByTeamId(team.id) : [];

  const users: IssueUser[] = userStore.all.map(u => ({
    avatarBackgroundColor: u.avatarBgColor,
    avatarUrl: u.avatarUrl ?? null,
    displayName: u.displayName,
    id: u.id,
    initials: u.initials,
  }));

  const labels: IssueLabel[] = labelStore.all.map(l => ({
    color: l.color,
    id: l.id,
    name: l.name,
  }));

  const handleCreate = useIssueCreate(team, states);

  if (!team) {
    return null;
  }

  return (
    <CreateIssueModal
      labels={labels}
      onClose={() => uiStore.closeCreateIssueModal()}
      onSubmit={handleCreate}
      open={uiStore.createIssueModalOpen}
      states={states}
      teamId={team.id}
      users={users}
    />
  );
});
