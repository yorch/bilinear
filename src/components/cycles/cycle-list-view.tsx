'use client';

import { Calendar, RefreshCw } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import Link from 'next/link';
import { useState } from 'react';
import { InlineRetry } from '@/components/shared/inline-retry';
import { EmptyState } from '@/components/ui/empty-state';
import { ProgressBar } from '@/components/ui/progress-bar';
import { useFormatters } from '@/hooks/use-formatters';
import { useRetryableFetch } from '@/hooks/use-retryable-fetch';
import { useTranslations } from '@/hooks/use-translations';
import type { DBCycle } from '@/lib/db';
import { gqlQuery } from '@/lib/graphql';
import { CYCLES_PROGRESS_QUERY } from '@/lib/graphql-queries';
import { cn } from '@/lib/utils';
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

function getCycleStatusBadge(status: CycleStatus, t: ReturnType<typeof useTranslations>) {
  switch (status) {
    case 'active':
      return {
        className: 'bg-success-subtle text-success-subtle-foreground',
        label: t('cycles.status.active'),
      };
    case 'completed':
      return {
        className: 'bg-muted text-muted-foreground',
        label: t('cycles.status.completed'),
      };
    case 'upcoming':
      return {
        className: 'bg-info-subtle text-info-subtle-foreground',
        label: t('cycles.status.upcoming'),
      };
  }
}

export const CycleListView = observer(function CycleListView({
  teamId,
  workspaceKey,
  teamKey,
}: CycleListViewProps) {
  const { cycleStore } = useStore();
  const t = useTranslations();

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
      <div className="flex h-12 items-center justify-between border-b border-border px-4">
        <h1 className="text-sm font-semibold text-foreground">{t('cycles.list.title')}</h1>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        {hasNoCycles ? (
          <EmptyState
            description={t('cycles.list.emptyDescription')}
            icon={<RefreshCw className="h-5 w-5" />}
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
        <span className="font-normal text-muted-foreground">{cycles.length}</span>
      </button>
      {!collapsed && (
        <div className="mt-1 flex flex-col gap-1">
          {cycles.map(cycle => {
            const badge = getCycleStatusBadge(status, t);
            const stats = progressByCycle.get(cycle.id);
            const progress = stats ? Math.round(stats.progress * 100) : 0;
            const completedCount = stats ? Math.round(stats.progress * stats.scope) : 0;

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
                      {formatDate(cycle.startsAt, { day: 'numeric', month: 'short' })} &ndash;{' '}
                      {formatDate(cycle.endsAt, { day: 'numeric', month: 'short' })}
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

                <span
                  className={cn(
                    'rounded-full px-2 py-0.5 text-[10px] font-medium',
                    badge.className,
                  )}
                >
                  {badge.label}
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
});
