'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useRef } from 'react';
import { useFormatters } from '@/hooks/use-formatters';
import { useTranslations } from '@/hooks/use-translations';
import { cn } from '@/lib/utils';

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

const STATUS_BADGES: Record<string, { cls: string; labelKey: string }> = {
  backlog: {
    cls: 'bg-muted text-muted-foreground',
    labelKey: 'roadmap.public.status.backlog',
  },
  cancelled: {
    cls: 'bg-danger-subtle text-danger-subtle-foreground',
    labelKey: 'roadmap.public.status.cancelled',
  },
  completed: {
    cls: 'bg-success-subtle text-success-subtle-foreground',
    labelKey: 'roadmap.public.status.completed',
  },
  inProgress: {
    cls: 'bg-brand-subtle text-brand-subtle-foreground dark:text-brand',
    labelKey: 'roadmap.public.status.inProgress',
  },
  paused: {
    cls: 'bg-warning-subtle text-warning-subtle-foreground',
    labelKey: 'roadmap.public.status.paused',
  },
  planned: {
    cls: 'bg-info-subtle text-info-subtle-foreground',
    labelKey: 'roadmap.public.status.planned',
  },
};

const HEALTH_DOTS: Record<string, string> = {
  atRisk: 'bg-warning',
  noUpdate: 'bg-foreground-faint',
  offTrack: 'bg-danger',
  onTrack: 'bg-success',
};

function PasswordForm({ slug }: { slug: string }) {
  const t = useTranslations();
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
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm rounded-xl border border-border bg-card p-8 shadow-sm">
        <h2 className="mb-1 text-lg font-semibold text-foreground">
          {t('roadmap.public.passwordRequired')}
        </h2>
        <p className="mb-6 text-sm text-muted-foreground">
          {t('roadmap.public.passwordProtected')}
        </p>
        <form className="flex flex-col gap-3" onSubmit={handleSubmit}>
          <input
            className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
            placeholder={t('roadmap.public.enterPassword')}
            ref={inputRef}
            required
            type="password"
          />
          <button
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-brand focus:ring-offset-2 dark:focus:ring-offset-background"
            type="submit"
          >
            {t('roadmap.public.continue')}
          </button>
        </form>
      </div>
    </div>
  );
}

export function PublicRoadmapView({ projects, requiresPassword, roadmap }: Props) {
  const t = useTranslations();
  const { formatDate } = useFormatters();
  if (requiresPassword) {
    return (
      <Suspense fallback={<div className="flex min-h-screen items-center justify-center" />}>
        <PasswordForm slug={roadmap.slug} />
      </Suspense>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-4xl px-6 py-12">
        {/* Header */}
        <div className="mb-10">
          <h1 className="text-3xl font-bold tracking-tight text-foreground">{roadmap.title}</h1>
          {roadmap.description && (
            <p className="mt-3 text-base text-muted-foreground">{roadmap.description}</p>
          )}
        </div>

        {/* Project grid */}
        {projects.length === 0 ? (
          <div className="rounded-xl border border-border bg-card p-10 text-center">
            <p className="text-sm text-muted-foreground">{t('roadmap.public.noProjects')}</p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {projects.map(project => {
              const statusInfo = STATUS_BADGES[project.statusType] ?? STATUS_BADGES.planned;
              const healthDot = project.health ? HEALTH_DOTS[project.health] : null;
              const targetDateStr = project.targetDate
                ? formatDate(project.targetDate, { month: 'short', year: 'numeric' })
                : null;
              const progressPct = Math.round(project.progress * 100);

              return (
                <div
                  className="flex flex-col gap-3 rounded-xl border border-border bg-card p-5 shadow-xs"
                  key={project.id}
                >
                  {/* Title row */}
                  <div className="flex items-center gap-2">
                    {project.icon ? (
                      <span className="text-lg leading-none">{project.icon}</span>
                    ) : (
                      <span
                        className="h-3 w-3 shrink-0 rounded-full"
                        style={{ backgroundColor: project.color }}
                      />
                    )}
                    <span className="flex-1 truncate text-sm font-semibold text-foreground">
                      {project.name}
                    </span>
                  </div>

                  {/* Badges row */}
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={cn(
                        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
                        statusInfo.cls,
                      )}
                    >
                      {project.statusName ?? t(statusInfo.labelKey)}
                    </span>
                    {healthDot && (
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        <span className={cn('h-2 w-2 rounded-full', healthDot)} />
                        {project.health}
                      </span>
                    )}
                    {targetDateStr && (
                      <span className="text-xs text-muted-foreground">
                        {t('roadmap.public.target', { date: targetDateStr })}
                      </span>
                    )}
                  </div>

                  {/* Progress bar */}
                  <div>
                    <div className="mb-1 flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">
                        {t('roadmap.public.progress')}
                      </span>
                      <span className="text-xs font-medium text-muted-foreground">
                        {progressPct}%
                      </span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-brand transition-all"
                        style={{ width: `${progressPct}%` }}
                      />
                    </div>
                  </div>

                  {/* Milestones */}
                  {project.milestoneCount > 0 && (
                    <p className="text-xs text-muted-foreground">
                      {project.milestoneCount}{' '}
                      {project.milestoneCount === 1
                        ? t('roadmap.public.milestone')
                        : t('roadmap.public.milestones')}
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
