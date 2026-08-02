'use client';

import { Calendar, Plus, Target } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { InlineRetry } from '@/components/shared/inline-retry';
import { useRetryableFetch } from '@/hooks/use-retryable-fetch';
import { useTranslations } from '@/hooks/use-translations';
import { gqlQuery } from '@/lib/graphql';
import { PROJECTS_PROGRESS_QUERY } from '@/lib/graphql-queries';
import {
  PROJECT_HEALTH_CONFIG,
  PROJECT_HEALTH_LABEL_KEYS,
  PROJECT_STATUS_CONFIG,
  PROJECT_STATUS_LABEL_KEYS,
} from '@/lib/project-constants';
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

const ACTIVE_STATUSES = ['inProgress', 'planned', 'backlog'];
const COMPLETED_STATUSES = ['completed', 'canceled'];

export const ProjectListView = observer(function ProjectListView({
  workspaceKey,
}: ProjectListViewProps) {
  const t = useTranslations();
  const { projectStore, uiStore } = useStore();
  const projects = projectStore.all;

  // biome-ignore lint/correctness/useExhaustiveDependencies: pool.size is the intentional reactive trigger
  const activeProjects = useMemo(
    () => projects.filter(p => ACTIVE_STATUSES.includes(p.statusType)),
    [projectStore.pool.size],
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: pool.size is the intentional reactive trigger
  const completedProjects = useMemo(
    () => projects.filter(p => COMPLETED_STATUSES.includes(p.statusType)),
    [projectStore.pool.size],
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
        {projects.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
              <Target className="h-6 w-6 text-muted-foreground" />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">{t('projects.noProjectsYet')}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {t('projects.createProjectPrompt')}
              </p>
            </div>
            <button
              className="mt-2 flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              onClick={() => uiStore.openCreateProjectModal()}
              type="button"
            >
              <Plus className="h-4 w-4" />
              {t('projects.createProject')}
            </button>
          </div>
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
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  return (
    <div>
      <button
        className="flex items-center gap-2 px-1 py-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground-secondary"
        onClick={() => setCollapsed(!collapsed)}
        type="button"
      >
        <svg
          aria-hidden="true"
          className={cn('h-3 w-3 transition-transform', collapsed ? '' : 'rotate-90')}
          fill="currentColor"
          viewBox="0 0 20 20"
        >
          <path
            clipRule="evenodd"
            d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z"
            fillRule="evenodd"
          />
        </svg>
        {title}
        <span className="font-normal text-muted-foreground">{projects.length}</span>
      </button>
      {!collapsed && (
        <div className="mt-1 flex flex-col gap-1">
          {projects.map(project => {
            const status =
              PROJECT_STATUS_CONFIG[project.statusType] ?? PROJECT_STATUS_CONFIG.planned;
            const health = project.health ? PROJECT_HEALTH_CONFIG[project.health] : null;
            const lead = project.leadId ? userStore.findById(project.leadId) : null;

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
                    backgroundColor: `${project.color}20`,
                    color: project.color,
                  }}
                >
                  {project.icon ?? ''}
                </span>

                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm font-medium text-foreground">
                    {project.name}
                  </span>
                  <div className="mt-0.5 flex items-center gap-2">
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
                  </div>
                </div>

                {stats !== undefined && stats.scope > 0 && (
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-brand transition-all"
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                    <span className="text-xs tabular-nums text-muted-foreground">{progress}%</span>
                  </div>
                )}

                {project.targetDate && (
                  <span className="hidden items-center gap-1 text-xs text-muted-foreground sm:flex">
                    <Calendar className="h-3 w-3" />
                    {project.targetDate}
                  </span>
                )}

                {lead && (
                  <span
                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-medium text-white"
                    style={{ backgroundColor: lead.avatarBgColor }}
                    title={lead.displayName}
                  >
                    {lead.initials}
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
});
