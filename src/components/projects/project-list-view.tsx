'use client';

import { Calendar, Plus, Target } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import Link from 'next/link';
import { useMemo } from 'react';
import { InlineRetry } from '@/components/shared/inline-retry';
import { Button } from '@/components/ui/button';
import { CollapsibleGroup } from '@/components/ui/collapsible-group';
import { EmptyState } from '@/components/ui/empty-state';
import { ProgressBar } from '@/components/ui/progress-bar';
import { RowsSkeleton } from '@/components/ui/skeleton';
import { UserAvatar } from '@/components/ui/user-avatar';
import { useFormatters } from '@/hooks/use-formatters';
import { useRetryableFetch } from '@/hooks/use-retryable-fetch';
import { useTranslations } from '@/hooks/use-translations';
import { gqlQuery } from '@/lib/graphql';
import { PROJECTS_PROGRESS_QUERY } from '@/lib/graphql-queries';
import { toIssueUsers } from '@/lib/issue-mappers';
import {
  PROJECT_HEALTH_CONFIG,
  PROJECT_HEALTH_LABEL_KEYS,
  PROJECT_STATUS_CONFIG,
  PROJECT_STATUS_LABEL_KEYS,
  projectListGroup,
} from '@/lib/project-constants';
import { formatDateOnly, toDateOnly } from '@/lib/project-dates';
import { cn } from '@/lib/utils';
import { useStore } from '@/providers/store-provider';

interface ProjectListViewProps {
  workspaceKey: string;
}

/** `progress` is a 0..1 fraction; `scope` is the live issue count. */
interface ServerProgress {
  progress: number;
  scope: number;
}

type ProgressByProject = Map<string, ServerProgress>;

export const ProjectListView = observer(function ProjectListView({
  workspaceKey,
}: ProjectListViewProps) {
  const t = useTranslations();
  const { projectStore, syncStore, uiStore } = useStore();
  const projects = projectStore.all;
  const bootstrapping = syncStore.status === 'idle' || syncStore.status === 'bootstrapping';

  // Sorted by target date (soonest first, undated last) so the order is
  // legible; the store's own order is priority-then-created, which reads as
  // arbitrary in a list that shows dates.
  // biome-ignore lint/correctness/useExhaustiveDependencies: pool.size is the intentional reactive trigger
  const sorted = useMemo(
    () =>
      [...projects].sort((a, b) => {
        const ad = toDateOnly(a.targetDate) ?? '9999-99-99';
        const bd = toDateOnly(b.targetDate) ?? '9999-99-99';
        return ad === bd ? a.name.localeCompare(b.name) : ad.localeCompare(bd);
      }),
    [projectStore.pool.size, projects],
  );
  const activeProjects = useMemo(
    () => sorted.filter(p => projectListGroup(p.statusType) === 'active'),
    [sorted],
  );
  const completedProjects = useMemo(
    () => sorted.filter(p => projectListGroup(p.statusType) === 'completed'),
    [sorted],
  );

  // Progress comes from the server, for every project on the page in one
  // request. Dividing over `issueStore` divides over whatever issues this
  // client happens to hold, and a guest's pool is scoped to issues they created
  // or are assigned — so one owned issue in a 50-issue project renders as 100%.
  // `Project.progress`/`Project.scope` are resolved from the full issue set
  // server-side, behind the `projectProgress` DataLoader, so this is two queries
  // for the whole list rather than one per row.
  const {
    data: progressByProject,
    error: progressError,
    refetch: refetchProgress,
  } = useRetryableFetch<ProgressByProject>(
    async () => {
      const connection = await gqlQuery<{ nodes: Array<ServerProgress & { id: string }> } | null>(
        PROJECTS_PROGRESS_QUERY,
        {},
        'projects',
      );
      return new Map(
        (connection?.nodes ?? []).map(n => [n.id, { progress: n.progress, scope: n.scope }]),
      );
    },
    // Refetch when the project set changes so a newly created project picks up
    // a bar. Issue-level changes don't invalidate this — the server value is a
    // snapshot, same as the initiatives page.
    [projectStore.pool.size],
    new Map(),
  );

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {projects.length === 0 && bootstrapping ? (
          // Not "No projects yet": the pool is empty only because the bootstrap
          // hasn't landed, and a populated workspace would flash the empty CTA.
          <RowsSkeleton count={6} />
        ) : projects.length === 0 ? (
          <EmptyState
            action={
              <Button onClick={() => uiStore.openCreateProjectModal()} size="sm" type="button">
                <Plus className="h-3.5 w-3.5" />
                {t('projects.newProject')}
              </Button>
            }
            description={t('projects.createProjectPrompt')}
            icon={<Target className="h-5 w-5" />}
            title={t('projects.noProjectsYet')}
          />
        ) : (
          <div className="flex flex-col gap-6">
            {/* One retry for the whole page — the per-row alternative would be
                N copies of the same failure. Rows render no bar until this
                lands, rather than a placeholder 0%. */}
            {progressError && (
              <InlineRetry
                className="py-0"
                message={t('common.somethingWentWrong')}
                onRetry={() => refetchProgress()}
              />
            )}

            {activeProjects.length > 0 && (
              <ProjectGroup
                progressByProject={progressByProject}
                projects={activeProjects}
                title={t('projects.active')}
                workspaceKey={workspaceKey}
              />
            )}

            {completedProjects.length > 0 && (
              <ProjectGroup
                defaultCollapsed
                progressByProject={progressByProject}
                projects={completedProjects}
                title={t('projects.completed')}
                workspaceKey={workspaceKey}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
});

const ProjectGroup = observer(function ProjectGroup({
  title,
  projects,
  progressByProject,
  workspaceKey,
  defaultCollapsed = false,
}: {
  title: string;
  projects: Array<{
    id: string;
    name: string;
    slugId: string;
    statusType: string;
    health?: string | null;
    leadId?: string | null;
    startDate?: string | null;
    targetDate?: string | null;
    color: string;
    icon?: string | null;
  }>;
  progressByProject: ProgressByProject;
  workspaceKey: string;
  defaultCollapsed?: boolean;
}) {
  const t = useTranslations();
  const { userStore } = useStore();
  const { intlLocale } = useFormatters();

  return (
    <CollapsibleGroup count={projects.length} defaultCollapsed={defaultCollapsed} title={title}>
      <div className="mt-1 flex flex-col gap-1">
        {projects.map(project => {
          const status = PROJECT_STATUS_CONFIG[project.statusType] ?? PROJECT_STATUS_CONFIG.planned;
          const health = project.health ? PROJECT_HEALTH_CONFIG[project.health] : null;
          const lead = project.leadId ? userStore.findById(project.leadId) : null;
          const target = formatDateOnly(project.targetDate, intlLocale);

          // Absent until the server answers (and after a failed load): the
          // bar is omitted entirely rather than rendered at a stand-in 0%.
          const stats = progressByProject.get(project.id);
          const progress = stats ? Math.round(stats.progress * 100) : 0;

          return (
            <Link
              className="group flex items-center gap-3 rounded-lg border border-transparent px-3 py-2.5 transition-colors hover:border-border hover:bg-accent"
              href={`/${workspaceKey}/project/${project.slugId}`}
              key={project.id}
            >
              <span
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-xs"
                style={{
                  backgroundColor: `color-mix(in srgb, ${project.color} 15%, transparent)`,
                  color: project.color,
                }}
              >
                {project.icon || <Target aria-hidden="true" className="h-3.5 w-3.5" />}
              </span>

              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm font-medium text-foreground">{project.name}</span>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2">
                  <span className={cn('text-xs', status.color)}>
                    {t(
                      PROJECT_STATUS_LABEL_KEYS[project.statusType] ??
                        PROJECT_STATUS_LABEL_KEYS.planned,
                    )}
                  </span>
                  {health && (
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <span className={cn('h-1.5 w-1.5 rounded-full', health.color)} />
                      {t(PROJECT_HEALTH_LABEL_KEYS[project.health ?? ''])}
                    </span>
                  )}
                  {target && (
                    <span className="text-xs text-muted-foreground sm:hidden">{target}</span>
                  )}
                </div>
              </div>

              {/* Fixed-width cells: an empty one keeps its slot, so the bar,
                  date and avatar line up down the list. */}
              <div className="hidden w-28 shrink-0 items-center gap-2 sm:flex">
                {stats !== undefined && stats.scope > 0 && (
                  <>
                    <ProgressBar className="h-1.5 w-16" value={progress} />
                    <span className="w-8 text-xs tabular-nums text-muted-foreground">
                      {progress}%
                    </span>
                  </>
                )}
              </div>

              <div className="hidden w-28 shrink-0 items-center gap-1 text-xs text-muted-foreground sm:flex">
                {target && (
                  <>
                    <Calendar className="h-3 w-3 shrink-0" />
                    <span className="truncate">{target}</span>
                  </>
                )}
              </div>

              <div className="flex w-5 shrink-0 justify-end" title={lead?.displayName}>
                {lead && <UserAvatar size="sm" user={toIssueUsers([lead])[0]} />}
              </div>
            </Link>
          );
        })}
      </div>
    </CollapsibleGroup>
  );
});
