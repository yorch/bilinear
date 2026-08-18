'use client';

import { ArrowLeft, Calendar, CircleDot, User } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import Link from 'next/link';
import { useMemo } from 'react';
import { ProgressSparkline } from '@/components/projects/progress-sparkline';
import { ProjectMilestonesSection } from '@/components/projects/project-milestones-section';
import { ProjectUpdatesSection } from '@/components/projects/project-updates-section';
import { InlineRetry } from '@/components/shared/inline-retry';
import { ProgressBar } from '@/components/ui/progress-bar';
import { SimpleSelect } from '@/components/ui/select';
import { useDocumentTitle } from '@/hooks/use-document-title';
import { useRetryableFetch } from '@/hooks/use-retryable-fetch';
import { useTranslations } from '@/hooks/use-translations';
import { gqlMutate, gqlQuery } from '@/lib/graphql';
import { PROJECT_PROGRESS_QUERY } from '@/lib/graphql-queries';
import { buildIssueHref } from '@/lib/issue-nav';
import {
  PROJECT_HEALTH_LABEL_KEYS,
  PROJECT_HEALTH_OPTIONS,
  PROJECT_HEALTH_SELECTED_CLASSES,
  PROJECT_STATUS_CONFIG,
  PROJECT_STATUS_LABEL_KEYS,
} from '@/lib/project-constants';
import { toast } from '@/lib/toast';
import { cn, TOUCH_TARGET_SQUARE } from '@/lib/utils';
import { useStore } from '@/providers/store-provider';

/** Shared by the status and health selects — one operation, one selection set. */
const PROJECT_UPDATE_MUTATION = `mutation ($id: ID!, $input: ProjectUpdateInput!) {
  projectUpdate(id: $id, input: $input) { success }
}`;

interface ProjectDetailViewProps {
  projectSlugId: string;
  workspaceKey: string;
}

/** `progress` is a 0..1 fraction; `scope` is the live issue count. */
interface ServerProgress {
  progress: number;
  scope: number;
}

export const ProjectDetailView = observer(function ProjectDetailView({
  projectSlugId,
  workspaceKey,
}: ProjectDetailViewProps) {
  const t = useTranslations();
  const { projectStore, issueStore, userStore, workflowStateStore } = useStore();
  const viewerId = userStore.currentUserId ?? '';
  const project = projectStore.findBySlugId(projectSlugId);

  useDocumentTitle(project?.name);

  // The issue *list* below stays store-derived on purpose: it renders the
  // issues this client actually holds, and each row links to one. The progress
  // *percentage* must not be derived from it — see `projectProgress` below.
  // useMemo must be called before any early return (Rules of Hooks).
  // pool.size is the MobX reactive dependency per repo convention.
  // biome-ignore lint/correctness/useExhaustiveDependencies: issueStore.pool.size is the intentional reactive trigger
  const projectIssues = useMemo(
    () => (project ? issueStore.findByProjectId(project.id) : []),
    [project?.id, issueStore.pool.size],
  );

  const projectId = project?.id;
  // Progress comes from the server. Dividing over `issueStore` divides over
  // whatever issues this client happens to hold, and a guest's pool is scoped
  // to issues they created or are assigned — so one owned issue in a 50-issue
  // project renders as 100%. `Project.progress`/`Project.scope` are resolved
  // from the full issue set server-side.
  const {
    data: projectProgress,
    error: progressError,
    refetch: refetchProgress,
  } = useRetryableFetch<ServerProgress | null>(
    () =>
      projectId
        ? gqlQuery<ServerProgress | null>(PROJECT_PROGRESS_QUERY, { id: projectId }, 'project')
        : Promise.resolve(null),
    [projectId],
    null,
  );

  if (!project) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        {t('projects.projectNotFound')}
      </div>
    );
  }

  const status = PROJECT_STATUS_CONFIG[project.statusType] ?? PROJECT_STATUS_CONFIG.planned;
  const lead = project.leadId ? userStore.findById(project.leadId) : null;

  // Null until the server answers (and while retrying after a failure) — the
  // bar and the ratio render blank rather than defaulting to 0%, which is the
  // silently-wrong value this whole path exists to avoid. `completed` is
  // recovered from the server's own ratio: `progress` is completed/scope, so
  // rounding the product back out is exact for any realistic issue count.
  const progressStats = projectProgress
    ? {
        completed: Math.round(projectProgress.progress * projectProgress.scope),
        percent: Math.round(projectProgress.progress * 100),
        total: projectProgress.scope,
      }
    : null;

  const handleStatusChange = async (newStatus: string) => {
    try {
      // `gqlMutate` throws on a GraphQL-level failure, so a rejected write
      // reaches the catch instead of leaving the store-backed select to snap
      // back with no explanation.
      await gqlMutate(PROJECT_UPDATE_MUTATION, {
        id: project.id,
        input: { statusType: newStatus },
      });
    } catch {
      toast.error(t('projects.failedToUpdateStatus'));
    }
  };

  const handleHealthChange = async (newHealth: string) => {
    try {
      await gqlMutate(PROJECT_UPDATE_MUTATION, { id: project.id, input: { health: newHealth } });
    } catch {
      toast.error(t('projects.failedToUpdateHealth'));
    }
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex h-12 items-center gap-3 border-b border-border px-4">
        <Link
          className={cn(
            'flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground-secondary',
            TOUCH_TARGET_SQUARE,
          )}
          href={`/${workspaceKey}/projects`}
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
        <h1 className="text-sm font-semibold text-foreground">{project.name}</h1>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-4xl px-6 py-6">
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <div className="flex items-center gap-2">
              <CircleDot className={cn('h-4 w-4', status.color)} />
              <SimpleSelect
                onChange={handleStatusChange}
                options={Object.entries(PROJECT_STATUS_CONFIG).map(([value]) => ({
                  label: t(PROJECT_STATUS_LABEL_KEYS[value]),
                  value,
                }))}
                value={project.statusType}
                variant="ghost"
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">{t('projects.healthLabel')}</span>
              <div className="flex gap-1">
                {PROJECT_HEALTH_OPTIONS.map(h => (
                  <button
                    className={cn(
                      'rounded px-2 py-0.5 text-xs font-medium transition-colors',
                      project.health === h.value
                        ? PROJECT_HEALTH_SELECTED_CLASSES[h.value]
                        : 'bg-muted text-muted-foreground hover:bg-accent',
                    )}
                    key={h.value}
                    onClick={() => handleHealthChange(h.value)}
                    type="button"
                  >
                    {t(PROJECT_HEALTH_LABEL_KEYS[h.value])}
                  </button>
                ))}
              </div>
            </div>
            {lead && (
              <div className="flex items-center gap-1.5">
                <User className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">{lead.displayName}</span>
              </div>
            )}
            {(project.startDate || project.targetDate) && (
              <div className="flex items-center gap-1.5">
                <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">
                  {project.startDate ?? '?'} &rarr; {project.targetDate ?? '?'}
                </span>
              </div>
            )}
          </div>
          {project.description && (
            <p className="mt-4 text-sm text-muted-foreground">{project.description}</p>
          )}
          <div className="mt-6 rounded-lg border border-border p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">
                {t('projects.progress')}
              </span>
              <span className="text-xs tabular-nums text-muted-foreground">
                {progressStats
                  ? t('projects.issuesCountRatio', {
                      completed: progressStats.completed,
                      progress: progressStats.percent,
                      total: progressStats.total,
                    })
                  : '—'}
              </span>
            </div>
            <ProgressBar className="mt-2 h-2" value={progressStats?.percent ?? 0} />
            {progressError && (
              <InlineRetry
                className="py-2"
                message={t('common.somethingWentWrong')}
                onRetry={() => refetchProgress()}
              />
            )}
            <div className="mt-3 flex items-center justify-between">
              <span className="text-xs text-muted-foreground">{t('projects.trend')}</span>
              <ProgressSparkline projectId={project.id} />
            </div>
          </div>
          <ProjectMilestonesSection projectId={project.id} />
          <div className="mt-6">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {t('projects.issuesCount', { count: projectIssues.length })}
              </h3>
            </div>
            <div className="mt-2 flex flex-col gap-0.5">
              {projectIssues.length === 0 ? (
                <p className="py-8 text-center text-xs text-muted-foreground">
                  {t('projects.noIssuesAssigned')}
                </p>
              ) : (
                projectIssues.map(issue => {
                  const state = workflowStateStore.findById(issue.stateId);
                  return (
                    <Link
                      className="flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors hover:bg-accent"
                      href={buildIssueHref(workspaceKey, issue.id, {
                        label: project.name,
                        path: `/${workspaceKey}/project/${project.slugId}`,
                      })}
                      key={issue.id}
                    >
                      {state && (
                        <span
                          className="h-3 w-3 shrink-0 rounded-full border-2"
                          style={{ borderColor: state.color }}
                        />
                      )}
                      <span className="shrink-0 text-xs font-mono text-muted-foreground">
                        {issue.identifier}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-foreground">{issue.title}</span>
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
