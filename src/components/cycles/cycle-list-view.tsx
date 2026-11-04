'use client';

import { differenceInCalendarDays } from 'date-fns';
import { Calendar, Plus, RefreshCw } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { CreateCycleModal } from '@/components/cycles/create-cycle-modal';
import { InlineRetry } from '@/components/shared/inline-retry';
import { readTeamExtras } from '@/components/teams/team-settings-helpers';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CollapsibleGroup } from '@/components/ui/collapsible-group';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { ProgressBar } from '@/components/ui/progress-bar';
import { useFormatters } from '@/hooks/use-formatters';
import { useRetryableFetch } from '@/hooks/use-retryable-fetch';
import { useTranslations } from '@/hooks/use-translations';
import type { DBCycle } from '@/lib/db';
import { gqlQuery } from '@/lib/graphql';
import { CYCLES_PROGRESS_QUERY } from '@/lib/graphql-queries';
import { toast } from '@/lib/toast';
import { useStore } from '@/providers/store-provider';

interface CycleListViewProps {
  teamId: string;
  teamKey: string;
  workspaceKey: string;
}

/** `progress` is a 0..1 fraction; `scope` is the live issue count. */
interface ServerProgress {
  progress: number;
  scope: number;
}

type ProgressByCycle = Map<string, ServerProgress>;

function getCycleDisplayName(cycle: DBCycle, t: ReturnType<typeof useTranslations>): string {
  return cycle.name || t('cycles.defaultName', { number: cycle.number });
}

type CycleStatus = 'active' | 'completed' | 'upcoming';

export const CycleListView = observer(function CycleListView({
  teamId,
  workspaceKey,
  teamKey,
}: CycleListViewProps) {
  const { cycleStore, teamStore } = useStore();
  const t = useTranslations();
  const router = useRouter();
  const [creating, setCreating] = useState(false);

  const team = teamStore.findById(teamId);
  const cyclesEnabled = team?.cyclesEnabled ?? false;
  const settingsHref = `/${workspaceKey}/team/${teamKey}/settings`;

  const newCycleButton = (
    <Button
      disabled={!cyclesEnabled}
      onClick={() => setCreating(true)}
      size="sm"
      title={cyclesEnabled ? undefined : t('cycles.create.disabledHint')}
      type="button"
      variant="outline"
    >
      <Plus className="h-3.5 w-3.5" />
      {t('cycles.create.button')}
    </Button>
  );

  const disabledHint = !cyclesEnabled && (
    <p className="text-xs text-muted-foreground">
      {t('cycles.create.disabledHint')}{' '}
      <Link className="text-brand-subtle-foreground hover:underline" href={settingsHref}>
        {t('cycles.create.openTeamSettings')}
      </Link>
    </p>
  );

  const activeCycle = cycleStore.getActiveCycle(teamId);
  const upcomingCycles = cycleStore.getUpcomingCycles(teamId);
  const completedCycles = cycleStore.getCompletedCycles(teamId);

  const activeCycles = activeCycle ? [activeCycle] : [];
  const hasNoCycles =
    activeCycles.length === 0 && upcomingCycles.length === 0 && completedCycles.length === 0;

  // Progress comes from the server, not from `issueStore`. A guest's local pool
  // holds only the issues they created or are assigned, and a canceled issue is
  // resolved without ever getting a `completedAt` — so a client-side count is
  // wrong twice over. `Cycle.progress`/`scope` sit behind the `cycleProgress`
  // DataLoader, so the whole list costs one batched call. (`cycle-detail-view`
  // moved to this when cycle progress went server-side; the list was missed.)
  const {
    data: progressByCycle,
    error: progressError,
    refetch: refetchProgress,
  } = useRetryableFetch<ProgressByCycle>(
    async () => {
      const cycles = await gqlQuery<Array<ServerProgress & { id: string }> | null>(
        CYCLES_PROGRESS_QUERY,
        { teamId },
        'cycles',
      );
      return new Map((cycles ?? []).map(c => [c.id, { progress: c.progress, scope: c.scope }]));
    },
    // Refetch when the cycle set changes so a new cycle picks up a bar. Issue
    // churn doesn't invalidate it — the server value is a snapshot, matching
    // how the projects list treats the same data.
    [teamId, cycleStore.pool.size],
    new Map(),
  );

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* PageHeader, not a hand-rolled `h-12 border-b` row. */}
      <PageHeader
        actions={
          <div className="flex items-center gap-3">
            {!hasNoCycles && disabledHint}
            {(cyclesEnabled || !hasNoCycles) && newCycleButton}
          </div>
        }
        title={t('cycles.list.teamTitle', { team: team?.displayName ?? team?.name ?? '' })}
      />

      <CreateCycleModal
        defaultDurationWeeks={readTeamExtras(team).cycleDuration ?? 2}
        onClose={() => setCreating(false)}
        onCreated={cycle => {
          cycleStore.applySyncAction('I', cycle.id, cycle);
          toast.success(t('cycles.create.created'));
          router.push(`/${workspaceKey}/team/${teamKey}/cycles/${cycle.id}`);
        }}
        open={creating}
        teamId={teamId}
      />

      <div className="flex-1 overflow-y-auto px-4 py-4">
        {hasNoCycles ? (
          <EmptyState
            action={
              cyclesEnabled ? (
                newCycleButton
              ) : (
                // A disabled "New cycle" next to a hint reads as a broken
                // button; the actionable thing is turning cycles on.
                <Button asChild size="sm">
                  <Link href={settingsHref}>{t('cycles.list.enableCycles')}</Link>
                </Button>
              )
            }
            description={t('cycles.list.emptyDescription')}
            icon={<RefreshCw className="h-5 w-5" />}
            testId="empty-state"
            title={t('cycles.list.emptyTitle')}
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

            {activeCycles.length > 0 && (
              <CycleGroup
                cycles={activeCycles}
                progressByCycle={progressByCycle}
                status="active"
                teamKey={teamKey}
                title={t('cycles.status.active')}
                workspaceKey={workspaceKey}
              />
            )}

            {upcomingCycles.length > 0 && (
              <CycleGroup
                cycles={upcomingCycles}
                progressByCycle={progressByCycle}
                status="upcoming"
                teamKey={teamKey}
                title={t('cycles.status.upcoming')}
                workspaceKey={workspaceKey}
              />
            )}

            {completedCycles.length > 0 && (
              <CycleGroup
                cycles={completedCycles}
                defaultCollapsed
                progressByCycle={progressByCycle}
                status="completed"
                teamKey={teamKey}
                title={t('cycles.status.completed')}
                workspaceKey={workspaceKey}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
});

/** Upcoming cycles shown before the "Show N more" disclosure. */
const UPCOMING_PREVIEW = 3;

const CycleGroup = observer(function CycleGroup({
  title,
  cycles,
  status,
  workspaceKey,
  teamKey,
  defaultCollapsed = false,
  progressByCycle,
}: {
  title: string;
  cycles: DBCycle[];
  status: CycleStatus;
  workspaceKey: string;
  teamKey: string;
  defaultCollapsed?: boolean;
  progressByCycle: ProgressByCycle;
}) {
  const t = useTranslations();
  const { formatDate } = useFormatters();
  const [showAll, setShowAll] = useState(false);
  // Enabling cycles generates a dozen-plus upcoming cycles at once; showing all
  // of them pushes Completed off-screen and adds nothing, so only the next few
  // render until asked.
  const limit = status === 'upcoming' && !showAll ? UPCOMING_PREVIEW : cycles.length;
  const visible = cycles.slice(0, limit);
  const hidden = cycles.length - visible.length;
  const thisYear = new Date().getFullYear();

  const formatRange = (cycle: DBCycle) => {
    const start = new Date(cycle.startsAt);
    const end = new Date(cycle.endsAt);
    // Year only when it disambiguates: a range crossing New Year or one that
    // isn't in the current year ("Dec 21 – Jan 4" reads as the wrong Jan).
    const withYear = start.getFullYear() !== end.getFullYear() || end.getFullYear() !== thisYear;
    const opts: Intl.DateTimeFormatOptions = withYear
      ? { day: 'numeric', month: 'short', year: 'numeric' }
      : { day: 'numeric', month: 'short' };
    return `${formatDate(cycle.startsAt, opts)} \u2013 ${formatDate(cycle.endsAt, opts)}`;
  };

  return (
    <CollapsibleGroup count={cycles.length} defaultCollapsed={defaultCollapsed} title={title}>
      <div className="mt-1 flex flex-col gap-1">
        {visible.map(cycle => {
          const stats = progressByCycle.get(cycle.id);
          const progress = stats ? Math.round(stats.progress * 100) : 0;
          const completedCount = stats ? Math.round(stats.progress * stats.scope) : 0;
          const daysLeft =
            status === 'active'
              ? Math.max(0, differenceInCalendarDays(new Date(cycle.endsAt), new Date()))
              : null;

          return (
            <Link
              className="group flex items-center gap-3 rounded-lg border border-transparent px-3 py-2.5 transition-colors hover:border-border hover:bg-accent"
              href={`/${workspaceKey}/team/${teamKey}/cycles/${cycle.id}`}
              key={cycle.id}
            >
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-muted text-muted-foreground">
                <RefreshCw className="h-3.5 w-3.5" />
              </span>

              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm font-medium text-foreground">
                  {getCycleDisplayName(cycle, t)}
                </span>
                <div className="mt-0.5 flex items-center gap-2">
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Calendar className="h-3 w-3" />
                    {formatRange(cycle)}
                  </span>
                </div>
              </div>

              {stats !== undefined && stats.scope > 0 && (
                <div className="flex items-center gap-2">
                  <ProgressBar className="h-1.5 w-16" value={progress} />
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {completedCount}/{stats.scope}
                  </span>
                </div>
              )}

              {/* The group header already says Upcoming / Completed; a pill per
                  row repeated it. Active keeps one, with the time left. */}
              {status === 'active' && (
                <Badge tone="success" variant="pill">
                  {t('cycles.list.daysLeft', { count: daysLeft ?? 0 })}
                </Badge>
              )}
            </Link>
          );
        })}
        {hidden > 0 && (
          <button
            className="self-start rounded px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground-secondary"
            onClick={() => setShowAll(true)}
            type="button"
          >
            {t('cycles.list.showMore', { count: hidden })}
          </button>
        )}
      </div>
    </CollapsibleGroup>
  );
});
