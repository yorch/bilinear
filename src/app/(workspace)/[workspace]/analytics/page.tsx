'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from '@/hooks/use-translations';
import { gql } from '@/lib/graphql';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TeamStats {
  avgCycleTimeDays: number;
  completedCount: number;
  completionRate: number;
  openCount: number;
  teamId: string;
  teamName: string;
  totalCount: number;
}

interface WorkspaceOverview {
  teams: TeamStats[];
  totalCompleted: number;
  totalIssues: number;
  totalOpen: number;
}

// ---------------------------------------------------------------------------
// GraphQL
// ---------------------------------------------------------------------------

const WORKSPACE_OVERVIEW_QUERY = `
  query WorkspaceOverview {
    analyticsWorkspaceOverview {
      totalIssues
      totalOpen
      totalCompleted
      teams {
        teamId
        teamName
        totalCount
        openCount
        completedCount
        completionRate
        avgCycleTimeDays
      }
    }
  }
`;

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <p className="text-xs font-medium uppercase tracking-wider text-zinc-400">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-zinc-900 dark:text-zinc-50">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-zinc-400">{sub}</p>}
    </div>
  );
}

function ProgressBar({ pct, color }: { pct: number; color: string }) {
  return (
    <div className="h-1.5 w-full rounded-full bg-zinc-100 dark:bg-zinc-800">
      <div
        className="h-1.5 rounded-full transition-all"
        style={{ backgroundColor: color, width: `${Math.min(pct, 100)}%` }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function WorkspaceAnalyticsPage() {
  const t = useTranslations();
  const [data, setData] = useState<WorkspaceOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    gql(WORKSPACE_OVERVIEW_QUERY)
      .then(res => {
        if (res.errors?.length) {
          const errMsg = (res.errors[0] as { message?: string } | undefined)?.message;
          setError(errMsg ?? t('analytics.workspace.failedToLoad'));
          return;
        }
        const d = res.data as { analyticsWorkspaceOverview: WorkspaceOverview };
        setData(d.analyticsWorkspaceOverview);
      })
      .catch(() => setError(t('analytics.workspace.failedToLoad')))
      .finally(() => setLoading(false));
  }, [t]);

  const maxCompleted = data ? Math.max(...data.teams.map(t => t.completedCount), 1) : 1;

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      {/* Header */}
      <div className="border-b border-zinc-200 px-6 py-4 dark:border-zinc-800">
        <h1 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
          {t('analytics.workspace.title')}
        </h1>
        <p className="mt-0.5 text-xs text-zinc-400">{t('analytics.workspace.subtitle')}</p>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-5">
        {loading && <p className="text-sm text-zinc-400">{t('analytics.workspace.loading')}</p>}

        {error && <p className="text-sm text-red-500">{error}</p>}

        {data && (
          <>
            {/* Org-level stat cards */}
            <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatCard label={t('analytics.workspace.totalIssues')} value={data.totalIssues} />
              <StatCard label={t('analytics.workspace.openIssues')} value={data.totalOpen} />
              <StatCard
                label={t('analytics.workspace.completed')}
                sub={t('analytics.workspace.completionRateSub', {
                  pct:
                    data.totalIssues > 0
                      ? Math.round((data.totalCompleted / data.totalIssues) * 100)
                      : 0,
                })}
                value={data.totalCompleted}
              />
              <StatCard label={t('analytics.workspace.activeTeams')} value={data.teams.length} />
            </div>

            {/* Per-team table */}
            <div className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
              <div className="border-b border-zinc-200 px-5 py-3 dark:border-zinc-800">
                <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">
                  {t('analytics.workspace.teams')}
                </h2>
              </div>

              {data.teams.length === 0 ? (
                <p className="px-5 py-8 text-center text-sm text-zinc-400">
                  {t('analytics.workspace.noTeamsFound')}
                </p>
              ) : (
                <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {/* Table header */}
                  <div className="grid grid-cols-12 gap-2 px-5 py-2 text-[11px] font-medium uppercase tracking-wider text-zinc-400">
                    <span className="col-span-3">{t('analytics.workspace.team')}</span>
                    <span className="col-span-2 text-right">{t('analytics.workspace.total')}</span>
                    <span className="col-span-2 text-right">{t('analytics.workspace.open')}</span>
                    <span className="col-span-2 text-right">
                      {t('analytics.workspace.completedCol')}
                    </span>
                    <span className="col-span-2 text-right">
                      {t('analytics.workspace.avgCycle')}
                    </span>
                    <span className="col-span-1" />
                  </div>

                  {data.teams.map(team => (
                    <div
                      className="grid grid-cols-12 items-center gap-2 px-5 py-3"
                      key={team.teamId}
                    >
                      <span
                        className="col-span-3 truncate text-sm font-medium text-zinc-800 dark:text-zinc-100"
                        title={team.teamName}
                      >
                        {team.teamName}
                      </span>
                      <span className="col-span-2 text-right text-sm text-zinc-500">
                        {team.totalCount}
                      </span>
                      <span className="col-span-2 text-right text-sm text-zinc-500">
                        {team.openCount}
                      </span>
                      <span
                        className={cn(
                          'col-span-2 text-right text-sm font-medium',
                          team.completionRate >= 70
                            ? 'text-green-600 dark:text-green-400'
                            : team.completionRate >= 40
                              ? 'text-yellow-600 dark:text-yellow-400'
                              : 'text-zinc-500',
                        )}
                      >
                        {team.completedCount}
                        <span className="ml-1 text-xs font-normal text-zinc-400">
                          ({Math.round(team.completionRate)}%)
                        </span>
                      </span>
                      <span className="col-span-2 text-right text-sm text-zinc-500">
                        {team.avgCycleTimeDays > 0 ? `${team.avgCycleTimeDays.toFixed(1)}d` : '—'}
                      </span>
                      <div className="col-span-1" />

                      {/* Completion bar */}
                      <div className="col-span-12 -mt-1">
                        <ProgressBar
                          color={
                            team.completionRate >= 70
                              ? '#22c55e'
                              : team.completionRate >= 40
                                ? '#eab308'
                                : '#a1a1aa'
                          }
                          pct={team.completionRate}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Velocity comparison bar chart */}
            {data.teams.length > 0 && (
              <div className="mt-5 rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
                <h2 className="mb-4 text-sm font-semibold text-zinc-700 dark:text-zinc-200">
                  {t('analytics.workspace.issuesCompletedByTeam')}
                </h2>
                <div className="flex flex-col gap-2">
                  {data.teams.map(team => {
                    const pct = maxCompleted > 0 ? (team.completedCount / maxCompleted) * 100 : 0;
                    return (
                      <div className="flex items-center gap-2" key={team.teamId}>
                        <span
                          className="w-32 shrink-0 truncate text-xs text-zinc-500"
                          title={team.teamName}
                        >
                          {team.teamName}
                        </span>
                        <div className="flex-1 rounded bg-zinc-100 dark:bg-zinc-800">
                          <div
                            className="h-5 rounded transition-all"
                            style={{
                              backgroundColor: '#6366f1',
                              width: `${Math.max(pct, team.completedCount > 0 ? 2 : 0)}%`,
                            }}
                          />
                        </div>
                        <span className="w-10 shrink-0 text-right text-xs font-medium text-zinc-600 dark:text-zinc-300">
                          {team.completedCount}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
