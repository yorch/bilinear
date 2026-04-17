'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useRef } from 'react';

interface RoadmapProject {
  color: string;
  health: string | null;
  icon: string | null;
  id: string;
  milestoneCount: number;
  name: string;
  progress: number;
  statusName: string | null;
  statusType: string;
  targetDate: Date | string | null;
}

interface RoadmapMeta {
  description: string | null;
  passwordHash: null;
  slug: string;
  title: string;
}

interface Props {
  projects: RoadmapProject[];
  requiresPassword: boolean;
  roadmap: RoadmapMeta;
}

const STATUS_BADGES: Record<string, { cls: string; label: string }> = {
  backlog: {
    cls: 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400',
    label: 'Backlog',
  },
  cancelled: {
    cls: 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400',
    label: 'Cancelled',
  },
  completed: {
    cls: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
    label: 'Completed',
  },
  inProgress: {
    cls: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400',
    label: 'In Progress',
  },
  paused: {
    cls: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
    label: 'Paused',
  },
  planned: {
    cls: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    label: 'Planned',
  },
};

const HEALTH_DOTS: Record<string, string> = {
  atRisk: 'bg-yellow-400',
  noUpdate: 'bg-zinc-300 dark:bg-zinc-600',
  offTrack: 'bg-red-500',
  onTrack: 'bg-green-500',
};

function formatDate(d: Date | string | null): string | null {
  if (!d) {
    return null;
  }
  const date = typeof d === 'string' ? new Date(d) : d;
  return date.toLocaleDateString(undefined, {
    month: 'short',
    year: 'numeric',
  });
}

function PasswordForm({ slug }: { slug: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const inputRef = useRef<HTMLInputElement>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const pw = inputRef.current?.value ?? '';
    const params = new URLSearchParams(searchParams.toString());
    params.set('password', pw);
    router.push(`/roadmap/${slug}?${params.toString()}`);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 dark:bg-zinc-950 px-4">
      <div className="w-full max-w-sm rounded-xl border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
        <h2 className="mb-1 text-lg font-semibold text-zinc-900 dark:text-zinc-100">
          Password required
        </h2>
        <p className="mb-6 text-sm text-zinc-500 dark:text-zinc-400">
          This roadmap is password protected.
        </p>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <input
            ref={inputRef}
            required
            type="password"
            placeholder="Enter password"
            className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-200 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 dark:focus:border-indigo-500 dark:focus:ring-indigo-800/40"
          />
          <button
            type="submit"
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:ring-offset-2 dark:focus:ring-offset-zinc-900"
          >
            Continue
          </button>
        </form>
      </div>
    </div>
  );
}

export function PublicRoadmapView({
  projects,
  requiresPassword,
  roadmap,
}: Props) {
  if (requiresPassword) {
    return (
      <Suspense
        fallback={
          <div className="flex min-h-screen items-center justify-center" />
        }
      >
        <PasswordForm slug={roadmap.slug} />
      </Suspense>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <div className="mx-auto max-w-4xl px-6 py-12">
        {/* Header */}
        <div className="mb-10">
          <h1 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
            {roadmap.title}
          </h1>
          {roadmap.description && (
            <p className="mt-3 text-base text-zinc-500 dark:text-zinc-400">
              {roadmap.description}
            </p>
          )}
        </div>

        {/* Project grid */}
        {projects.length === 0 ? (
          <div className="rounded-xl border border-zinc-200 bg-white p-10 text-center dark:border-zinc-700 dark:bg-zinc-900">
            <p className="text-sm text-zinc-400">
              No projects on this roadmap yet.
            </p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {projects.map(project => {
              const statusInfo =
                STATUS_BADGES[project.statusType] ?? STATUS_BADGES.planned;
              const healthDot = project.health
                ? HEALTH_DOTS[project.health]
                : null;
              const targetDateStr = formatDate(project.targetDate);
              const progressPct = Math.round(project.progress * 100);

              return (
                <div
                  key={project.id}
                  className="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-5 shadow-xs dark:border-zinc-700 dark:bg-zinc-900"
                >
                  {/* Title row */}
                  <div className="flex items-center gap-2">
                    {project.icon ? (
                      <span className="text-lg leading-none">
                        {project.icon}
                      </span>
                    ) : (
                      <span
                        className="h-3 w-3 shrink-0 rounded-full"
                        style={{ backgroundColor: project.color }}
                      />
                    )}
                    <span className="flex-1 truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                      {project.name}
                    </span>
                  </div>

                  {/* Badges row */}
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${statusInfo.cls}`}
                    >
                      {project.statusName ?? statusInfo.label}
                    </span>
                    {healthDot && (
                      <span className="flex items-center gap-1 text-xs text-zinc-500 dark:text-zinc-400">
                        <span className={`h-2 w-2 rounded-full ${healthDot}`} />
                        {project.health}
                      </span>
                    )}
                    {targetDateStr && (
                      <span className="text-xs text-zinc-400 dark:text-zinc-500">
                        Target: {targetDateStr}
                      </span>
                    )}
                  </div>

                  {/* Progress bar */}
                  <div>
                    <div className="mb-1 flex items-center justify-between">
                      <span className="text-xs text-zinc-400 dark:text-zinc-500">
                        Progress
                      </span>
                      <span className="text-xs font-medium text-zinc-600 dark:text-zinc-300">
                        {progressPct}%
                      </span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                      <div
                        className="h-full rounded-full bg-indigo-500 transition-all"
                        style={{ width: `${progressPct}%` }}
                      />
                    </div>
                  </div>

                  {/* Milestones */}
                  {project.milestoneCount > 0 && (
                    <p className="text-xs text-zinc-400 dark:text-zinc-500">
                      {project.milestoneCount}{' '}
                      {project.milestoneCount === 1
                        ? 'milestone'
                        : 'milestones'}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
