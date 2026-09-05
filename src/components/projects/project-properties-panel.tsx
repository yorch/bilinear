'use client';

import { Check, Pencil, Plus, X } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useState } from 'react';
import { AssigneeSelect } from '@/components/properties/assignee-select';
import { DueDatePicker } from '@/components/properties/due-date-picker';
import { PrioritySelect } from '@/components/properties/priority-select';
import { LoadError } from '@/components/shared/load-error';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { POPOVER_ITEM_CLASS, SelectPopover } from '@/components/ui/select-popover';
import { RowsSkeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { useRetryableFetch } from '@/hooks/use-retryable-fetch';
import { useTranslations } from '@/hooks/use-translations';
import type { DBProject } from '@/lib/db';
import { gqlMutate, gqlQuery } from '@/lib/graphql';
import { toIssueUsers } from '@/lib/issue-mappers';
import { toast } from '@/lib/toast';
import { cn, getErrorMessage, TOUCH_TARGET } from '@/lib/utils';
import { useStore } from '@/providers/store-provider';

/** One operation for every scalar property; the input carries the field. */
const PROJECT_UPDATE_MUTATION = `mutation ($id: ID!, $input: ProjectUpdateInput!) {
  projectUpdate(id: $id, input: $input) { success }
}`;

const PROJECT_TEAMS_MEMBERS_QUERY = `query ($id: ID!) {
  project(id: $id) {
    id
    teams { id name }
    members { id displayName }
  }
}`;

const PROJECT_ADD_TEAM_MUTATION = `mutation ($projectId: ID!, $teamId: ID!) {
  projectAddTeam(projectId: $projectId, teamId: $teamId) { success }
}`;
const PROJECT_REMOVE_TEAM_MUTATION = `mutation ($projectId: ID!, $teamId: ID!) {
  projectRemoveTeam(projectId: $projectId, teamId: $teamId) { success }
}`;
const PROJECT_ADD_MEMBER_MUTATION = `mutation ($projectId: ID!, $userId: ID!) {
  projectAddMember(projectId: $projectId, userId: $userId) { success }
}`;
const PROJECT_REMOVE_MEMBER_MUTATION = `mutation ($projectId: ID!, $userId: ID!) {
  projectRemoveMember(projectId: $projectId, userId: $userId) { success }
}`;

interface Membership {
  members: { displayName: string; id: string }[];
  teams: { id: string; name: string }[];
}

interface ProjectPropertiesPanelProps {
  project: DBProject;
}

/**
 * The editable properties of a project — everything past status and health,
 * which the detail view's top strip already owned.
 *
 * Scalars go through `projectUpdate` and rely on the sync stream to land in
 * `projectStore`, exactly as status/health do: the write is the source of
 * truth and the store converges, so there is no local copy to roll back.
 * Teams and members are not mirrored into the client DB at all, so they are
 * fetched here and re-fetched silently after each add/remove.
 */
export const ProjectPropertiesPanel = observer(function ProjectPropertiesPanel({
  project,
}: ProjectPropertiesPanelProps) {
  const t = useTranslations();
  const { teamStore, userStore } = useStore();

  const [editingName, setEditingName] = useState(false);
  const [draftName, setDraftName] = useState(project.name);
  const [editingDescription, setEditingDescription] = useState(false);
  const [draftDescription, setDraftDescription] = useState(project.description);

  const {
    data: membership,
    loading: membershipLoading,
    error: membershipError,
    cause: membershipCause,
    refetch: reloadMembership,
  } = useRetryableFetch<Membership>(
    async () =>
      (await gqlQuery<Membership | null>(
        PROJECT_TEAMS_MEMBERS_QUERY,
        { id: project.id },
        'project',
      )) ?? { members: [], teams: [] },
    [project.id],
    { members: [], teams: [] },
  );

  async function update(input: Record<string, unknown>) {
    try {
      await gqlMutate(PROJECT_UPDATE_MUTATION, { id: project.id, input });
      toast.success(t('projects.projectUpdated'));
      return true;
    } catch (err) {
      toast.error(getErrorMessage(err, t('projects.failedToUpdate')));
      return false;
    }
  }

  async function saveName() {
    const trimmed = draftName.trim();
    if (trimmed && trimmed !== project.name) {
      await update({ name: trimmed });
    }
    setEditingName(false);
  }

  async function saveDescription() {
    if (draftDescription !== project.description) {
      await update({ description: draftDescription });
    }
    setEditingDescription(false);
  }

  async function changeMembership(mutation: string, variables: Record<string, unknown>) {
    try {
      await gqlMutate(mutation, { projectId: project.id, ...variables });
      toast.success(t('projects.projectUpdated'));
      await reloadMembership({ silent: true });
    } catch (err) {
      toast.error(getErrorMessage(err, t('projects.failedToUpdate')));
    }
  }

  const memberIds = new Set(membership.members.map(m => m.id));
  const teamIds = new Set(membership.teams.map(tm => tm.id));
  const addableTeams = teamStore.all.filter(tm => !teamIds.has(tm.id));
  const addableUsers = userStore.all.filter(u => u.active && !memberIds.has(u.id));

  const rowClass = 'grid grid-cols-3 items-start gap-3';
  const labelClass = 'pt-1 text-xs font-medium text-muted-foreground';

  return (
    <div className="flex flex-col gap-4">
      {/* Name */}
      <div className={rowClass}>
        <span className={labelClass}>{t('projects.name')}</span>
        <div className="col-span-2 flex items-center gap-2">
          {editingName ? (
            <form
              className="flex flex-1 items-center gap-1"
              onSubmit={e => {
                e.preventDefault();
                void saveName();
              }}
            >
              <Input
                aria-label={t('projects.name')}
                autoFocus
                onChange={e => setDraftName(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Escape') {
                    setDraftName(project.name);
                    setEditingName(false);
                  }
                }}
                value={draftName}
              />
              <Button aria-label={t('common.save')} size="icon" type="submit" variant="ghost">
                <Check className="h-4 w-4" />
              </Button>
            </form>
          ) : (
            <>
              <span className="text-sm text-foreground">{project.name}</span>
              <button
                aria-label={t('common.edit')}
                className={cn(
                  'rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground-secondary',
                  TOUCH_TARGET,
                )}
                onClick={() => {
                  setDraftName(project.name);
                  setEditingName(true);
                }}
                type="button"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
            </>
          )}
        </div>
      </div>

      {/* Description */}
      <div className={rowClass}>
        <span className={labelClass}>{t('projects.description')}</span>
        <div className="col-span-2">
          {editingDescription ? (
            <div className="flex flex-col gap-2">
              <Textarea
                aria-label={t('projects.description')}
                autoFocus
                onChange={e => setDraftDescription(e.target.value)}
                rows={3}
                value={draftDescription}
              />
              <div className="flex justify-end gap-2">
                <Button
                  onClick={() => {
                    setDraftDescription(project.description);
                    setEditingDescription(false);
                  }}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  {t('common.cancel')}
                </Button>
                <Button onClick={() => void saveDescription()} size="sm" type="button">
                  {t('common.save')}
                </Button>
              </div>
            </div>
          ) : (
            <button
              className="w-full rounded px-1 py-0.5 text-left text-sm hover:bg-muted"
              onClick={() => {
                setDraftDescription(project.description);
                setEditingDescription(true);
              }}
              type="button"
            >
              {project.description ? (
                <span className="whitespace-pre-wrap text-foreground-secondary">
                  {project.description}
                </span>
              ) : (
                <span className="text-muted-foreground">{t('projects.addDescription')}</span>
              )}
            </button>
          )}
        </div>
      </div>

      {/* Lead */}
      <div className={rowClass}>
        <span className={labelClass}>{t('projects.lead')}</span>
        <div className="col-span-2">
          <AssigneeSelect
            onChange={leadId => void update({ leadId })}
            users={toIssueUsers(userStore.all.filter(u => u.active))}
            value={project.leadId}
          />
        </div>
      </div>

      {/* Priority */}
      <div className={rowClass}>
        <span className={labelClass}>{t('properties.priority.label')}</span>
        <div className="col-span-2">
          <PrioritySelect
            onChange={priority => void update({ priority })}
            value={project.priority}
          />
        </div>
      </div>

      {/* Dates */}
      <div className={rowClass}>
        <span className={labelClass}>{t('projects.startDate')}</span>
        <div className="col-span-2">
          <DueDatePicker
            onChange={startDate => void update({ startDate })}
            value={project.startDate}
          />
        </div>
      </div>
      <div className={rowClass}>
        <span className={labelClass}>{t('projects.targetDate')}</span>
        <div className="col-span-2">
          <DueDatePicker
            onChange={targetDate => void update({ targetDate })}
            value={project.targetDate}
          />
        </div>
      </div>

      {/* Teams & members — fetched, not store-backed */}
      {membershipLoading ? (
        <RowsSkeleton count={2} />
      ) : membershipError ? (
        <LoadError
          cause={membershipCause}
          fallback={t('common.somethingWentWrong')}
          onRetry={() => reloadMembership()}
        />
      ) : (
        <>
          <div className={rowClass}>
            <span className={labelClass}>{t('projects.teams')}</span>
            <div className="col-span-2 flex flex-wrap items-center gap-1.5">
              {membership.teams.map(team => (
                <Badge key={team.id} tone="outline">
                  {team.name}
                  <button
                    aria-label={t('projects.removeTeam', { name: team.name })}
                    className="rounded-full text-muted-foreground hover:text-foreground"
                    onClick={() =>
                      void changeMembership(PROJECT_REMOVE_TEAM_MUTATION, { teamId: team.id })
                    }
                    type="button"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
              {addableTeams.length > 0 && (
                <SelectPopover
                  panelClassName="min-w-[180px] py-1"
                  triggerChildren={
                    <>
                      <Plus className="h-3 w-3" />
                      {t('projects.addTeam')}
                    </>
                  }
                  triggerClassName="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground-secondary"
                >
                  {close => (
                    <>
                      {addableTeams.map(team => (
                        <button
                          className={POPOVER_ITEM_CLASS}
                          key={team.id}
                          onClick={() => {
                            close();
                            void changeMembership(PROJECT_ADD_TEAM_MUTATION, { teamId: team.id });
                          }}
                          type="button"
                        >
                          {team.name}
                        </button>
                      ))}
                    </>
                  )}
                </SelectPopover>
              )}
            </div>
          </div>

          <div className={rowClass}>
            <span className={labelClass}>{t('projects.members')}</span>
            <div className="col-span-2 flex flex-wrap items-center gap-1.5">
              {membership.members.map(member => (
                <Badge key={member.id} tone="muted">
                  {member.displayName}
                  <button
                    aria-label={t('projects.removeMember', { name: member.displayName })}
                    className="rounded-full text-muted-foreground hover:text-foreground"
                    onClick={() =>
                      void changeMembership(PROJECT_REMOVE_MEMBER_MUTATION, { userId: member.id })
                    }
                    type="button"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
              {addableUsers.length > 0 && (
                <SelectPopover
                  panelClassName="max-h-64 min-w-[200px] overflow-y-auto py-1"
                  triggerChildren={
                    <>
                      <Plus className="h-3 w-3" />
                      {t('projects.addMember')}
                    </>
                  }
                  triggerClassName="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground-secondary"
                >
                  {close => (
                    <>
                      {addableUsers.map(user => (
                        <button
                          className={POPOVER_ITEM_CLASS}
                          key={user.id}
                          onClick={() => {
                            close();
                            void changeMembership(PROJECT_ADD_MEMBER_MUTATION, { userId: user.id });
                          }}
                          type="button"
                        >
                          {user.displayName}
                        </button>
                      ))}
                    </>
                  )}
                </SelectPopover>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
});
