'use client';

import { Button } from '@/components/ui/button';
import { ColorDot } from '@/components/ui/color-dot';
import { Input } from '@/components/ui/input';
import { ProgressBar } from '@/components/ui/progress-bar';
import { useFormatters } from '@/hooks/use-formatters';
import { useTranslations } from '@/hooks/use-translations';
import { PROJECT_HEALTH_LABEL_KEYS } from '@/lib/project-constants';
import { formatDateOnly, toDateOnly } from '@/lib/project-dates';
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
  passwordError?: 'rate' | 'wrong' | false;
  projects: RoadmapProject[];
  requiresPassword: boolean;
  roadmap: RoadmapMeta;
}

const STATUS_BADGES: Record<string, { cls: string; labelKey: string }> = {
  backlog: {
    cls: 'bg-muted text-muted-foreground',
    labelKey: 'roadmap.public.status.backlog',
  },
  // Keyed by `Project.status`, whose canceled value is `canceled` (one L) —
  // see PROJECT_STATUS_CONFIG. Spelled `cancelled` this entry never matched,
  // so a canceled project rendered with no status badge at all.
  canceled: {
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

/**
 * `PROJECT_HEALTH_LABEL_KEYS` covers the three health values a project update
 * can set; `noUpdate` is this page's own "never reported" dot, so it falls back
 * to the shared "none" label rather than rendering the raw enum.
 */
const HEALTH_NONE_LABEL_KEY = 'properties.updateForm.health.none';

function PasswordForm({ error, slug }: { error: 'rate' | 'wrong' | false; slug: string }) {
  const t = useTranslations();

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm rounded-xl border border-border bg-card p-8 shadow-e1">
        <h1 className="mb-1 text-lg font-semibold text-foreground">
          {t('roadmap.public.passwordRequired')}
        </h1>
        <p className="mb-6 text-sm text-muted-foreground">
          {t('roadmap.public.passwordProtected')}
        </p>
        {/* A plain POST, not a client-side navigation: the password goes in the
            request body and is exchanged for an httpOnly cookie, instead of
            sitting in the URL (history, logs, Referer). */}
        <form
          action={`/roadmap/${encodeURIComponent(slug)}/unlock`}
          className="flex flex-col gap-3"
          method="post"
        >
          <Input
            aria-describedby={error ? 'roadmap-password-error' : undefined}
            aria-invalid={!!error}
            aria-label={t('roadmap.public.enterPassword')}
            autoComplete="current-password"
            name="password"
            placeholder={t('roadmap.public.enterPassword')}
            required
            type="password"
          />
          {error && (
            <p
              className="text-xs text-danger-subtle-foreground"
              id="roadmap-password-error"
              role="alert"
            >
              {error === 'rate'
                ? t('roadmap.public.tooManyAttempts')
                : t('roadmap.public.wrongPassword')}
            </p>
          )}
          <Button type="submit">{t('roadmap.public.continue')}</Button>
        </form>
      </div>
    </div>
  );
}

export function groupRoadmapProjects<
  T extends { statusType: string; targetDate: Date | string | null; name: string },
>(projects: T[]): Array<{ items: T[]; status: string }> {
  const dateKey = (p: T) =>
    toDateOnly(p.targetDate instanceof Date ? p.targetDate.toISOString() : p.targetDate) ??
    '9999-99-99';
  const byDate = (a: T, b: T) =>
    dateKey(a).localeCompare(dateKey(b)) || a.name.localeCompare(b.name);
  return STATUS_SECTIONS.map(status => ({
    // An unrecognised status lands under Planned instead of vanishing.
    items: projects
      .filter(p => (STATUS_SECTIONS.includes(p.statusType) ? p.statusType : 'planned') === status)
      .sort(byDate),
    status,
  })).filter(g => g.items.length > 0);
}

/** Display order of the status sections: what is happening now first. */
const STATUS_SECTIONS = ['inProgress', 'planned', 'paused', 'backlog', 'completed', 'canceled'];
/** Statuses where "0%" is the expected state, so an empty bar says nothing. */
const NOT_STARTED = new Set(['backlog', 'planned', 'paused']);

export function PublicRoadmapView({
  passwordError = false,
  projects,
  requiresPassword,
  roadmap,
}: Props) {
  const t = useTranslations();
  const { intlLocale } = useFormatters();
  if (requiresPassword) {
    return <PasswordForm error={passwordError} slug={roadmap.slug} />;
  }

  const sections = groupRoadmapProjects(projects);

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

        {/* Grouped by status, soonest target first, so the page reads as a
            roadmap rather than an arbitrary card wall. */}
        {projects.length === 0 ? (
          <div className="rounded-xl border border-border bg-card p-10 text-center">
            <p className="text-sm text-muted-foreground">{t('roadmap.public.noProjects')}</p>
          </div>
        ) : (
          <div className="flex flex-col gap-10">
            {sections.map(({ items, status }) => (
              <section aria-labelledby={`roadmap-${status}`} key={status}>
                <h2
                  className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground"
                  id={`roadmap-${status}`}
                >
                  {t(STATUS_BADGES[status]?.labelKey ?? STATUS_BADGES.planned.labelKey)}
                  <span className="ml-2 font-normal">{items.length}</span>
                </h2>
                <div className="grid gap-4 sm:grid-cols-2">
                  {items.map(project => {
                    const statusInfo = STATUS_BADGES[project.statusType] ?? STATUS_BADGES.planned;
                    const healthDot = project.health ? HEALTH_DOTS[project.health] : null;
                    const targetDateStr = project.targetDate
                      ? formatDateOnly(
                          typeof project.targetDate === 'string'
                            ? project.targetDate
                            : project.targetDate.toISOString(),
                          intlLocale,
                          { month: 'short', year: 'numeric' },
                        )
                      : null;
                    const progressPct = Math.round(project.progress * 100);

                    return (
                      <div
                        className="flex flex-col gap-3 rounded-xl border border-border bg-card p-5 shadow-e1"
                        key={project.id}
                      >
                        {/* Title row */}
                        <div className="flex items-center gap-2">
                          {project.icon ? (
                            <span className="text-lg leading-none">{project.icon}</span>
                          ) : (
                            <ColorDot className="h-3 w-3" color={project.color} />
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
                              {t(
                                (project.health && PROJECT_HEALTH_LABEL_KEYS[project.health]) ??
                                  HEALTH_NONE_LABEL_KEY,
                              )}
                            </span>
                          )}
                          {targetDateStr && (
                            <span className="text-xs text-muted-foreground">
                              {t('roadmap.public.target', { date: targetDateStr })}
                            </span>
                          )}
                        </div>

                        {/* Progress bar — omitted for work that hasn't started, where
                      an empty bar reads as a problem rather than a plan. */}
                        {!(progressPct === 0 && NOT_STARTED.has(project.statusType)) && (
                          <div>
                            <div className="mb-1 flex items-center justify-between">
                              <span className="text-xs text-muted-foreground">
                                {t('roadmap.public.progress')}
                              </span>
                              <span className="text-xs font-medium text-muted-foreground">
                                {progressPct}%
                              </span>
                            </div>
                            <ProgressBar className="h-1.5 w-full" value={progressPct} />
                          </div>
                        )}

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
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
