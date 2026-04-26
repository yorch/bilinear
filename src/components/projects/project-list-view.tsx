'use client';

import { Calendar, Plus, Target } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import Link from 'next/link';
import { useState } from 'react';
import { PROJECT_HEALTH_CONFIG, PROJECT_STATUS_CONFIG } from '@/lib/project-constants';
import { cn } from '@/lib/utils';
import { useStore } from '@/providers/store-provider';

interface ProjectListViewProps {
  workspaceKey: string;
}

export const ProjectListView = observer(function ProjectListView({
  workspaceKey,
}: ProjectListViewProps) {
  const { projectStore, uiStore } = useStore();
  const projects = projectStore.all;

  const activeStatuses = ['inProgress', 'planned', 'backlog'];
  const completedStatuses = ['completed', 'canceled'];

  const activeProjects = projects.filter(p => activeStatuses.includes(p.statusType));
  const completedProjects = projects.filter(p => completedStatuses.includes(p.statusType));

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex h-12 items-center justify-between border-b border-zinc-200 px-4 dark:border-zinc-800">
        <h1 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Projects</h1>
        <button
          className="flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-indigo-700"
          onClick={() => uiStore.openCreateProjectModal()}
          type="button"
        >
          <Plus className="h-3.5 w-3.5" />
          New Project
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        {projects.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-800">
              <Target className="h-6 w-6 text-zinc-400" />
            </div>
            <div>
              <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                No projects yet
              </p>
              <p className="mt-1 text-xs text-zinc-500">
                Create a project to track work across teams.
              </p>
            </div>
            <button
              className="mt-2 flex items-center gap-1.5 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700"
              onClick={() => uiStore.openCreateProjectModal()}
              type="button"
            >
              <Plus className="h-4 w-4" />
              Create project
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            {activeProjects.length > 0 && (
              <ProjectGroup projects={activeProjects} title="Active" workspaceKey={workspaceKey} />
            )}

            {completedProjects.length > 0 && (
              <ProjectGroup
                defaultCollapsed
                projects={completedProjects}
                title="Completed"
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
  const { issueStore, userStore } = useStore();
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  return (
    <div>
      <button
        className="flex items-center gap-2 px-1 py-1 text-xs font-semibold uppercase tracking-wider text-zinc-400 hover:text-zinc-600 dark:text-zinc-500 dark:hover:text-zinc-300"
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
        <span className="font-normal text-zinc-400">{projects.length}</span>
      </button>
      {!collapsed && (
        <div className="mt-1 flex flex-col gap-1">
          {projects.map(project => {
            const status =
              PROJECT_STATUS_CONFIG[project.statusType] ?? PROJECT_STATUS_CONFIG.planned;
            const health = project.health ? PROJECT_HEALTH_CONFIG[project.health] : null;
            const lead = project.leadId ? userStore.findById(project.leadId) : null;

            const allIssues = issueStore.findByProjectId(project.id);
            const completedIssues = allIssues.filter(i => i.completedAt);
            const progress =
              allIssues.length > 0
                ? Math.round((completedIssues.length / allIssues.length) * 100)
                : 0;

            return (
              <Link
                className="group flex items-center gap-3 rounded-lg border border-transparent px-3 py-2.5 transition-colors hover:border-zinc-200 hover:bg-zinc-50 dark:hover:border-zinc-700 dark:hover:bg-zinc-900"
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
                  <span className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
                    {project.name}
                  </span>
                  <div className="mt-0.5 flex items-center gap-2">
                    <span className={cn('text-xs', status.color)}>{status.label}</span>
                    {health && (
                      <span className="flex items-center gap-1 text-xs text-zinc-500">
                        <span className={cn('h-1.5 w-1.5 rounded-full', health.color)} />
                        {health.label}
                      </span>
                    )}
                  </div>
                </div>

                {allIssues.length > 0 && (
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 w-16 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700">
                      <div
                        className="h-full rounded-full bg-indigo-500 transition-all"
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                    <span className="text-xs tabular-nums text-zinc-400">{progress}%</span>
                  </div>
                )}

                {project.targetDate && (
                  <span className="hidden items-center gap-1 text-xs text-zinc-400 sm:flex">
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
