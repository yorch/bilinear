'use client';

import { observer } from 'mobx-react-lite';
import { useParams, usePathname } from 'next/navigation';
import { useMemo, useState } from 'react';
import { CreateIssueModal } from '@/components/issues/create-issue-modal';
import { useIssueCreate } from '@/hooks/use-issue-create';
import { toIssueLabels, toIssueUsers } from '@/lib/issue-mappers';
import { useStore } from '@/providers/store-provider';

/**
 * Workspace-wide create-issue modal driven by `uiStore.createIssueModalOpen`
 * (opened by the global `C` shortcut, the command palette's Create Issue
 * action, and the team page's New-issue button). Defaults to the team from
 * the current route when on a team page (otherwise the alphabetically first
 * team), but the in-modal team picker lets the user switch before creating.
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
  const pathname = usePathname();

  const routeTeam = params.key ? teamStore.findByKey(params.key) : null;
  // Deterministic fallback off team routes: alphabetical, not pool order.
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on pool.size per convention (see AGENTS.md), not the array identity
  const sortedTeams = useMemo(
    () => [...teamStore.all].sort((a, b) => a.name.localeCompare(b.name)),
    [teamStore.pool.size],
  );
  const defaultTeam = routeTeam ?? sortedTeams[0] ?? null;

  // Mirrors GlobalCreateIssueModal's remount-per-open gating (§above), so a
  // plain useState initializer is enough — no reset effect needed between opens.
  const [selectedTeamId, setSelectedTeamId] = useState(defaultTeam?.id);
  const team = (selectedTeamId ? teamStore.findById(selectedTeamId) : null) ?? defaultTeam;

  const states = team ? workflowStateStore.findByTeamId(team.id) : [];
  // When the modal is opened from the triage page, default the new issue to
  // the triage state so it surfaces in the queue the user is looking at.
  // Otherwise default to the backlog state (the historical behaviour).
  // The triage default is snapshotted at open and only applies while the
  // selected team is still the route team — switching teams in the modal
  // falls back to backlog so we don't create a triage issue for the wrong team.
  const routeTeamId = routeTeam?.id;
  const onTriagePage = useState(() => pathname?.includes(`/team/${params.key}/triage`) ?? false)[0];
  const useTriageDefault = onTriagePage && team?.id === routeTeamId;
  const defaultStateId = useTriageDefault
    ? (states.find(s => s.type === 'triage')?.id ?? states[0]?.id)
    : (states.find(s => s.type === 'backlog')?.id ?? states[0]?.id);

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
      onTeamChange={setSelectedTeamId}
      open
      states={states}
      teamId={team.id}
      teams={sortedTeams}
      users={toIssueUsers(userStore.all)}
    />
  );
});
