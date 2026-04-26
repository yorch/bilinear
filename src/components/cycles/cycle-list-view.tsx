'use client';

import { Calendar, RefreshCw } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import Link from 'next/link';
import { useState } from 'react';
import type { DBCycle } from '@/lib/db';
import { cn } from '@/lib/utils';
import { useStore } from '@/providers/store-provider';

interface CycleListViewProps {
  teamId: string;
  teamKey: string;
  workspaceKey: string;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { day: 'numeric', month: 'short' });
}

function getCycleDisplayName(cycle: DBCycle): string {
  return cycle.name || `Cycle ${cycle.number}`;
}

type CycleStatus = 'active' | 'completed' | 'upcoming';

function getCycleStatusBadge(status: CycleStatus) {
  switch (status) {
    case 'active':
      return {
        className: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400',
        label: 'Active',
      };
    case 'completed':
      return {
        className: 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400',
        label: 'Completed',
      };
    case 'upcoming':
      return {
        className: 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-400',
        label: 'Upcoming',
      };
  }
}

export const CycleListView = observer(function CycleListView({
  teamId,
  workspaceKey,
  teamKey,
}: CycleListViewProps) {
  const { cycleStore } = useStore();

  const activeCycle = cycleStore.getActiveCycle(teamId);
  const upcomingCycles = cycleStore.getUpcomingCycles(teamId);
  const completedCycles = cycleStore.getCompletedCycles(teamId);

  const activeCycles = activeCycle ? [activeCycle] : [];
  const hasNoCycles =
    activeCycles.length === 0 && upcomingCycles.length === 0 && completedCycles.length === 0;

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex h-12 items-center justify-between border-b border-zinc-200 px-4 dark:border-zinc-800">
        <h1 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Cycles</h1>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        {hasNoCycles ? (
          <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-800">
              <RefreshCw className="h-6 w-6 text-zinc-400" />
            </div>
            <div>
              <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">No cycles yet</p>
              <p className="mt-1 text-xs text-zinc-500">
                Cycles help you plan and track work in time-boxed iterations.
              </p>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            {activeCycles.length > 0 && (
              <CycleGroup
                cycles={activeCycles}
                status="active"
                teamKey={teamKey}
                title="Active"
                workspaceKey={workspaceKey}
              />
            )}

            {upcomingCycles.length > 0 && (
              <CycleGroup
                cycles={upcomingCycles}
                status="upcoming"
                teamKey={teamKey}
                title="Upcoming"
                workspaceKey={workspaceKey}
              />
            )}

            {completedCycles.length > 0 && (
              <CycleGroup
                cycles={completedCycles}
                defaultCollapsed
                status="completed"
                teamKey={teamKey}
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

const CycleGroup = observer(function CycleGroup({
  title,
  cycles,
  status,
  workspaceKey,
  teamKey,
  defaultCollapsed = false,
}: {
  title: string;
  cycles: DBCycle[];
  status: CycleStatus;
  workspaceKey: string;
  teamKey: string;
  defaultCollapsed?: boolean;
}) {
  const { issueStore } = useStore();
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
        <span className="font-normal text-zinc-400">{cycles.length}</span>
      </button>
      {!collapsed && (
        <div className="mt-1 flex flex-col gap-1">
          {cycles.map(cycle => {
            const badge = getCycleStatusBadge(status);
            const cycleIssues = issueStore.findByCycleId(cycle.id);
            const completedIssues = cycleIssues.filter(i => i.completedAt);
            const progress =
              cycleIssues.length > 0
                ? Math.round((completedIssues.length / cycleIssues.length) * 100)
                : 0;

            return (
              <Link
                className="group flex items-center gap-3 rounded-lg border border-transparent px-3 py-2.5 transition-colors hover:border-zinc-200 hover:bg-zinc-50 dark:hover:border-zinc-700 dark:hover:bg-zinc-900"
                href={`/${workspaceKey}/team/${teamKey}/cycles/${cycle.id}`}
                key={cycle.id}
              >
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                  <RefreshCw className="h-3.5 w-3.5" />
                </span>

                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
                    {getCycleDisplayName(cycle)}
                  </span>
                  <div className="mt-0.5 flex items-center gap-2">
                    <span className="flex items-center gap-1 text-xs text-zinc-500">
                      <Calendar className="h-3 w-3" />
                      {formatDate(cycle.startsAt)} &ndash; {formatDate(cycle.endsAt)}
                    </span>
                  </div>
                </div>

                {cycleIssues.length > 0 && (
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 w-16 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700">
                      <div
                        className="h-full rounded-full bg-indigo-500 transition-all"
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                    <span className="text-xs tabular-nums text-zinc-400">
                      {completedIssues.length}/{cycleIssues.length}
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
