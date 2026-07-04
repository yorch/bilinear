'use client';

import { observer } from 'mobx-react-lite';
import { useParams } from 'next/navigation';
import { CreateIssueModal } from '@/components/issues/create-issue-modal';
import { useIssueCreate } from '@/hooks/use-issue-create';
import { toIssueLabels, toIssueUsers } from '@/lib/issue-mappers';
import { useStore } from '@/providers/store-provider';

/**
 * Workspace-wide create-issue modal driven by `uiStore.createIssueModalOpen`
 * (opened by the global `C` shortcut, the command palette's Create Issue
 * action, and the team page's New-issue button). Targets the team from the
 * current route when on a team page, otherwise the alphabetically first team.
 */
export const GlobalCreateIssueModal = observer(function GlobalCreateIssueModal() {
  const { uiStore } = useStore();

  // Gate before any store-collection reads: while closed this observer
  // tracks only the open flag, so user/label/state churn doesn't re-render
  // an invisible subtree on every page.
  if (!uiStore.createIssueModalOpen) {
    return null;
  }
  return <GlobalCreateIssueModalInner />;
});

const GlobalCreateIssueModalInner = observer(function GlobalCreateIssueModalInner() {
  const { uiStore, teamStore, workflowStateStore, userStore, labelStore } = useStore();
  const params = useParams<{ workspace?: string; key?: string }>();

  const routeTeam = params.key ? teamStore.findByKey(params.key) : null;
  // Deterministic fallback off team routes: alphabetical, not pool order.
  const team =
    routeTeam ?? [...teamStore.all].sort((a, b) => a.name.localeCompare(b.name))[0] ?? null;
  const states = team ? workflowStateStore.findByTeamId(team.id) : [];
  // Same default the team page's create path used: backlog state first.
  const defaultStateId = states.find(s => s.type === 'backlog')?.id ?? states[0]?.id;

  const handleCreate = useIssueCreate(team, states);

  if (!team) {
    return null;
  }

  return (
    <CreateIssueModal
      defaultStateId={defaultStateId}
      labels={toIssueLabels(labelStore.all)}
      onClose={() => uiStore.closeCreateIssueModal()}
      onSubmit={handleCreate}
      open
      states={states}
      teamId={team.id}
      users={toIssueUsers(userStore.all)}
    />
  );
});
