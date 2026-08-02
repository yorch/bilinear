'use client';

import { Calendar, Plus, Target } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useTranslations } from '@/hooks/use-translations';
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
            {activeProjects.length > 0 && (
              <ProjectGroup
                projects={activeProjects}
                title={t('projects.active')}
                workspaceKey={workspaceKey}
              />
            )}

            {completedProjects.length > 0 && (
              <ProjectGroup
                defaultCollapsed
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
  workspaceKey: string;
  defaultCollapsed?: boolean;
}) {
  const t = useTranslations();
  const { issueStore, userStore } = useStore();
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  // Pre-compute progress stats for all projects in this group so we don't call
  // findByProjectId() O(n) times inside the render loop. pool.size is the MobX
  // reactive dependency per repo convention (using the Map itself is unstable).
  // biome-ignore lint/correctness/useExhaustiveDependencies: issueStore.pool.size is the intentional reactive trigger
  const progressByProject = useMemo(() => {
    const stats = new Map<string, { total: number; progress: number }>();
    for (const project of projects) {
      const allIssues = issueStore.findByProjectId(project.id);
      const completed = allIssues.filter(i => i.completedAt).length;
      stats.set(project.id, {
        progress: allIssues.length > 0 ? Math.round((completed / allIssues.length) * 100) : 0,
        total: allIssues.length,
      });
    }
    return stats;
  }, [projects, issueStore.pool.size]);

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

            const { total: totalIssues, progress } = progressByProject.get(project.id) ?? {
              progress: 0,
              total: 0,
            };

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

                {totalIssues > 0 && (
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
