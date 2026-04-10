'use client';

import { ArrowLeft, Calendar, CircleDot, Target, User } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import Link from 'next/link';
import { ProjectUpdatesSection } from '@/components/projects/project-updates-section';
import { SimpleSelect } from '@/components/ui/select';
import { gql } from '@/lib/graphql';
import {
  PROJECT_HEALTH_OPTIONS,
  PROJECT_STATUS_CONFIG,
} from '@/lib/project-constants';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';
import { useStore } from '@/providers/store-provider';

interface ProjectDetailViewProps {
  projectSlugId: string;
  workspaceKey: string;
}

export const ProjectDetailView = observer(function ProjectDetailView({
  projectSlugId,
  workspaceKey,
}: ProjectDetailViewProps) {
  const { projectStore, issueStore, userStore, teamStore, workflowStateStore } =
    useStore();
  const viewerId = userStore.currentUserId ?? '';
  const project = projectStore.findBySlugId(projectSlugId);

  if (!project) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-zinc-400">
        Project not found.
      </div>
    );
  }

  const status =
    PROJECT_STATUS_CONFIG[project.statusType] ?? PROJECT_STATUS_CONFIG.planned;
  const lead = project.leadId ? userStore.findById(project.leadId) : null;

  const projectIssues = issueStore.findByProjectId(project.id);
  const completedIssues = projectIssues.filter(i => i.completedAt);
  const progress =
    projectIssues.length > 0
      ? Math.round((completedIssues.length / projectIssues.length) * 100)
      : 0;

  const milestones = projectStore.getMilestones(project.id);

  const handleStatusChange = async (newStatus: string) => {
    try {
      await gql(
        `mutation ($id: ID!, $input: ProjectUpdateInput!) {
          projectUpdate(id: $id, input: $input) { success }
        }`,
        { id: project.id, input: { statusType: newStatus } },
      );
    } catch {
      toast.error('Failed to update status');
    }
  };

  const handleHealthChange = async (newHealth: string) => {
    try {
      await gql(
        `mutation ($id: ID!, $input: ProjectUpdateInput!) {
          projectUpdate(id: $id, input: $input) { success }
        }`,
        { id: project.id, input: { health: newHealth } },
      );
    } catch {
      toast.error('Failed to update health');
    }
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex h-12 items-center gap-3 border-b border-zinc-200 px-4 dark:border-zinc-800">
        <Link
          href={`/${workspaceKey}/projects`}
          className="flex h-6 w-6 items-center justify-center rounded text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <span
          className="flex h-5 w-5 items-center justify-center rounded text-xs"
          style={{
            backgroundColor: `${project.color}20`,
            color: project.color,
          }}
        >
          {project.icon ?? ''}
        </span>
        <h1 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          {project.name}
        </h1>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-4xl px-6 py-6">
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <div className="flex items-center gap-2">
              <CircleDot className={cn('h-4 w-4', status.color)} />
              <SimpleSelect
                variant="ghost"
                options={Object.entries(PROJECT_STATUS_CONFIG).map(
                  ([value, cfg]) => ({ label: cfg.label, value }),
                )}
                value={project.statusType}
                onChange={handleStatusChange}
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-zinc-400">Health:</span>
              <div className="flex gap-1">
                {PROJECT_HEALTH_OPTIONS.map(h => (
                  <button
                    key={h.value}
                    type="button"
                    onClick={() => handleHealthChange(h.value)}
                    className={cn(
                      'rounded px-2 py-0.5 text-xs font-medium transition-colors',
                      project.health === h.value
                        ? `${h.color} text-white`
                        : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700',
                    )}
                  >
                    {h.label}
                  </button>
                ))}
              </div>
            </div>
            {lead && (
              <div className="flex items-center gap-1.5">
                <User className="h-3.5 w-3.5 text-zinc-400" />
                <span className="text-xs text-zinc-600 dark:text-zinc-400">
                  {lead.displayName}
                </span>
              </div>
            )}
            {(project.startDate || project.targetDate) && (
              <div className="flex items-center gap-1.5">
                <Calendar className="h-3.5 w-3.5 text-zinc-400" />
                <span className="text-xs text-zinc-500">
                  {project.startDate ?? '?'} &rarr; {project.targetDate ?? '?'}
                </span>
              </div>
            )}
          </div>
          {project.description && (
            <p className="mt-4 text-sm text-zinc-600 dark:text-zinc-400">
              {project.description}
            </p>
          )}
          <div className="mt-6 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                Progress
              </span>
              <span className="text-xs tabular-nums text-zinc-500">
                {completedIssues.length} / {projectIssues.length} issues (
                {progress}%)
              </span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700">
              <div
                className="h-full rounded-full bg-indigo-500 transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
          {milestones.length > 0 && (
            <div className="mt-6">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                Milestones
              </h3>
              <div className="mt-2 flex flex-col gap-2">
                {milestones.map(m => (
                  <div
                    key={m.id}
                    className="flex items-center gap-3 rounded-md border border-zinc-200 px-3 py-2 dark:border-zinc-800"
                  >
                    <Target className="h-4 w-4 shrink-0 text-zinc-400" />
                    <span className="flex-1 text-sm text-zinc-900 dark:text-zinc-100">
                      {m.name}
                    </span>
                    {m.targetDate && (
                      <span className="text-xs text-zinc-400">
                        {m.targetDate}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="mt-6">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                Issues ({projectIssues.length})
              </h3>
            </div>
            <div className="mt-2 flex flex-col gap-0.5">
              {projectIssues.length === 0 ? (
                <p className="py-8 text-center text-xs text-zinc-400">
                  No issues assigned to this project yet. Use Shift+P on any
                  issue to assign it.
                </p>
              ) : (
                projectIssues.map(issue => {
                  const state = workflowStateStore.findById(issue.stateId);
                  const team = teamStore.findById(issue.teamId);
                  return (
                    <Link
                      key={issue.id}
                      href={`/${workspaceKey}/team/${team?.key ?? ''}`}
                      className="flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-900"
                    >
                      {state && (
                        <span
                          className="h-3 w-3 shrink-0 rounded-full border-2"
                          style={{ borderColor: state.color }}
                        />
                      )}
                      <span className="shrink-0 text-xs font-mono text-zinc-400">
                        {issue.identifier}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-zinc-900 dark:text-zinc-100">
                        {issue.title}
                      </span>
                    </Link>
                  );
                })
              )}
            </div>
          </div>
          <ProjectUpdatesSection projectId={project.id} viewerId={viewerId} />
        </div>
      </div>
    </div>
  );
});
