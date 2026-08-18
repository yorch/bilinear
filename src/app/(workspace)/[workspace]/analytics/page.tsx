'use client';

import { InlineRetry } from '@/components/shared/inline-retry';
import { PageHeader } from '@/components/ui/page-header';
import { useDocumentTitle } from '@/hooks/use-document-title';
import { useRetryableFetch } from '@/hooks/use-retryable-fetch';
import { useTranslations } from '@/hooks/use-translations';
import { gqlQuery } from '@/lib/graphql';
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
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-foreground">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

function ProgressBar({ pct, color }: { pct: number; color: string }) {
  return (
    <div className="h-1.5 w-full rounded-full bg-muted">
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
  useDocumentTitle(t('analytics.workspace.title'));
  // gqlQuery throws on a GraphQL-level error, which is what makes the
  // InlineRetry branch below reachable — the previous hand-rolled effect
  // rendered a failed load as a dead-end message with no way to try again.
  const { data, loading, error, refetch } = useRetryableFetch<WorkspaceOverview | null>(
    () => gqlQuery<WorkspaceOverview>(WORKSPACE_OVERVIEW_QUERY, {}, 'analyticsWorkspaceOverview'),
    [],
    null,
  );

  const maxCompleted = data ? Math.max(...data.teams.map(t => t.completedCount), 1) : 1;

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      {/* Header */}
      <PageHeader
        description={t('analytics.workspace.subtitle')}
        title={t('analytics.workspace.title')}
      />

      <div className="flex-1 overflow-y-auto px-6 py-5">
        {loading && (
          <p className="text-sm text-muted-foreground">{t('analytics.workspace.loading')}</p>
        )}

        {error && (
          <InlineRetry message={t('analytics.workspace.failedToLoad')} onRetry={() => refetch()} />
        )}

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
            <div className="rounded-lg border border-border bg-card">
              <div className="border-b border-border px-5 py-3">
                <h2 className="text-sm font-semibold text-foreground">
                  {t('analytics.workspace.teams')}
                </h2>
              </div>

              {data.teams.length === 0 ? (
                <p className="px-5 py-8 text-center text-sm text-muted-foreground">
                  {t('analytics.workspace.noTeamsFound')}
                </p>
              ) : (
                <div className="divide-y divide-border">
                  {/* Table header */}
                  <div className="grid grid-cols-12 gap-2 px-5 py-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
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
                        className="col-span-3 truncate text-sm font-medium text-foreground"
                        title={team.teamName}
                      >
                        {team.teamName}
                      </span>
                      <span className="col-span-2 text-right text-sm text-muted-foreground">
                        {team.totalCount}
                      </span>
                      <span className="col-span-2 text-right text-sm text-muted-foreground">
                        {team.openCount}
                      </span>
                      <span
                        className={cn(
                          'col-span-2 text-right text-sm font-medium',
                          team.completionRate >= 70
                            ? 'text-success-subtle-foreground'
                            : team.completionRate >= 40
                              ? 'text-warning-subtle-foreground'
                              : 'text-muted-foreground',
                        )}
                      >
                        {team.completedCount}
                        <span className="ml-1 text-xs font-normal text-muted-foreground">
                          ({Math.round(team.completionRate)}%)
                        </span>
                      </span>
                      <span className="col-span-2 text-right text-sm text-muted-foreground">
                        {team.avgCycleTimeDays > 0 ? `${team.avgCycleTimeDays.toFixed(1)}d` : '—'}
                      </span>
                      <div className="col-span-1" />

                      {/* Completion bar */}
                      <div className="col-span-12 -mt-1">
                        <ProgressBar
                          color={
                            team.completionRate >= 70
                              ? 'var(--chart-actual)'
                              : team.completionRate >= 40
                                ? 'var(--chart-warning)'
                                : 'var(--chart-grid)'
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
              <div className="mt-5 rounded-lg border border-border bg-card p-5">
                <h2 className="mb-4 text-sm font-semibold text-foreground">
                  {t('analytics.workspace.issuesCompletedByTeam')}
                </h2>
                <div className="flex flex-col gap-2">
                  {data.teams.map(team => {
                    const pct = maxCompleted > 0 ? (team.completedCount / maxCompleted) * 100 : 0;
                    return (
                      <div className="flex items-center gap-2" key={team.teamId}>
                        <span
                          className="w-32 shrink-0 truncate text-xs text-muted-foreground"
                          title={team.teamName}
                        >
                          {team.teamName}
                        </span>
                        <div className="flex-1 rounded bg-muted">
                          <div
                            className="h-5 rounded transition-all"
                            style={{
                              backgroundColor: 'var(--chart-primary)',
                              width: `${Math.max(pct, team.completedCount > 0 ? 2 : 0)}%`,
                            }}
                          />
                        </div>
                        <span className="w-10 shrink-0 text-right text-xs font-medium text-muted-foreground">
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
