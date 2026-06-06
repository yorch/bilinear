'use client';

import { ArrowLeft, Calendar, RefreshCw, RotateCcw } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BurnupChart } from '@/components/cycles/burnup-chart';
import { gql } from '@/lib/graphql';
import { toast } from '@/lib/toast';
import { TransactionQueue } from '@/lib/transaction-queue';
import { cn } from '@/lib/utils';
import { useStore } from '@/providers/store-provider';

interface CycleDetailViewProps {
  cycleId: string;
  teamKey: string;
  workspaceKey: string;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

// ---------------------------------------------------------------------------
// GraphQL strings
// ---------------------------------------------------------------------------

const CYCLE_ROLLOVER_MUTATION = `
  mutation CycleRollover($cycleId: ID!) {
    cycleRollover(cycleId: $cycleId) { success lastSyncId movedCount nextCycleId }
  }
`;

const CYCLE_BURNDOWN_QUERY = `
  query CycleBurndown($cycleId: ID!) {
    cycleBurndown(cycleId: $cycleId) { date remaining completed scope }
  }
`;

const CYCLE_SCOPE_METRICS_QUERY = `
  query CycleScopeMetrics($cycleId: ID!) {
    analyticsCycleScopeMetrics(cycleId: $cycleId) {
      totalCount
      plannedCount
      completedCount
      scopeCreepCount
      scopeCreepPct
      carryoverCount
      carryoverPct
    }
  }
`;

const CYCLE_VELOCITY_QUERY = `
  query CycleVelocity($teamId: ID!, $cycleCount: Int) {
    cycleVelocity(teamId: $teamId, cycleCount: $cycleCount) {
      averageIssues
      cycles { cycleId cycleNumber completedIssues }
    }
  }
`;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface BurndownPoint {
  completed: number;
  date: string;
  remaining: number;
  scope: number;
}

interface ScopeMetrics {
  carryoverCount: number;
  carryoverPct: number;
  completedCount: number;
  plannedCount: number;
  scopeCreepCount: number;
  scopeCreepPct: number;
  totalCount: number;
}

interface VelocityCycle {
  completedIssues: number;
  cycleId: string;
  cycleNumber: number;
}

interface VelocityResult {
  averageIssues: number;
  cycles: VelocityCycle[];
}

// ---------------------------------------------------------------------------
// Burndown chart (SVG, no library)
// ---------------------------------------------------------------------------

interface BurndownChartProps {
  data: BurndownPoint[];
}

function BurndownChart({ data }: BurndownChartProps) {
  if (data.length === 0) {
    return (
      <p className="py-6 text-center text-xs text-zinc-400">
        Burndown data will appear once the cycle starts.
      </p>
    );
  }

  const width = 600;
  const height = 300;
  const paddingLeft = 36;
  const paddingRight = 12;
  const paddingTop = 12;
  const paddingBottom = 32;

  const chartWidth = width - paddingLeft - paddingRight;
  const chartHeight = height - paddingTop - paddingBottom;

  const maxY = Math.max(...data.map(d => Math.max(d.remaining, d.completed, d.scope)), 1);
  const n = data.length;

  const xScale = (i: number) => paddingLeft + (n > 1 ? (i / (n - 1)) * chartWidth : chartWidth / 2);
  const yScale = (v: number) => paddingTop + chartHeight - (v / maxY) * chartHeight;

  // Ideal burndown: linear from final scope down to 0 over the cycle duration.
  // Using final scope (not day-1 scope) so the ideal accounts for mid-sprint additions.
  const totalIssues = data[data.length - 1].scope;
  const idealPoints = data.map((_, i) => ({
    x: xScale(i),
    y: yScale(totalIssues - (totalIssues / (n - 1 || 1)) * i),
  }));

  const toPath = (pts: Array<{ x: number; y: number }>) =>
    pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');

  const remainingPath = toPath(data.map((d, i) => ({ x: xScale(i), y: yScale(d.remaining) })));
  const completedPath = toPath(data.map((d, i) => ({ x: xScale(i), y: yScale(d.completed) })));
  const idealPath = toPath(idealPoints);

  // Y-axis ticks
  const yTicks = [0, Math.round(maxY / 2), maxY];

  // X-axis: every 3rd label
  const xLabels = data
    .map((d, i) => ({
      i,
      label: new Date(d.date).toLocaleDateString('en-US', {
        day: 'numeric',
        month: 'short',
      }),
    }))
    .filter((_, i) => i % 3 === 0 || i === n - 1);

  return (
    <div className="w-full overflow-x-auto">
      <svg
        aria-label="Burndown chart"
        className="w-full"
        style={{ height: 300 }}
        viewBox={`0 0 ${width} ${height}`}
      >
        {/* Y-axis grid lines + labels */}
        {yTicks.map(v => {
          const y = yScale(v);
          return (
            <g key={v}>
              <line
                stroke="currentColor"
                strokeOpacity={0.08}
                strokeWidth={1}
                x1={paddingLeft}
                x2={width - paddingRight}
                y1={y}
                y2={y}
              />
              <text
                fill="currentColor"
                fontSize={10}
                opacity={0.45}
                textAnchor="end"
                x={paddingLeft - 4}
                y={y + 4}
              >
                {v}
              </text>
            </g>
          );
        })}

        {/* Ideal burndown (gray dashed) */}
        <path
          d={idealPath}
          fill="none"
          stroke="var(--chart-grid)"
          strokeDasharray="5,3"
          strokeWidth={1.5}
        />

        {/* Completed (green) */}
        <path d={completedPath} fill="none" stroke="var(--chart-actual)" strokeWidth={2} />

        {/* Remaining (blue) */}
        <path d={remainingPath} fill="none" stroke="var(--chart-ideal)" strokeWidth={2} />

        {/* X-axis labels */}
        {xLabels.map(({ i, label }) => (
          <text
            fill="currentColor"
            fontSize={9}
            key={i}
            opacity={0.45}
            textAnchor="middle"
            x={xScale(i)}
            y={height - 6}
          >
            {label}
          </text>
        ))}

        {/* Legend — each non-first item in its own <g> so offsets are self-contained */}
        <g transform={`translate(${paddingLeft + 4}, ${paddingTop + 4})`}>
          <line stroke="var(--chart-ideal)" strokeWidth={2} x1={0} x2={16} y1={6} y2={6} />
          <text fill="currentColor" fontSize={9} opacity={0.7} x={20} y={10}>
            Remaining
          </text>
          <g transform="translate(78, 0)">
            <line stroke="var(--chart-actual)" strokeWidth={2} x1={0} x2={16} y1={6} y2={6} />
            <text fill="currentColor" fontSize={9} opacity={0.7} x={20} y={10}>
              Completed
            </text>
          </g>
          <g transform="translate(158, 0)">
            <line
              stroke="var(--chart-grid)"
              strokeDasharray="5,3"
              strokeWidth={1.5}
              x1={0}
              x2={16}
              y1={6}
              y2={6}
            />
            <text fill="currentColor" fontSize={9} opacity={0.7} x={20} y={10}>
              Ideal
            </text>
          </g>
        </g>
      </svg>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Velocity bar chart (CSS, same pattern as analytics page)
// ---------------------------------------------------------------------------

interface VelocityBarChartProps {
  cycles: VelocityCycle[];
}

function VelocityBarChart({ cycles }: VelocityBarChartProps) {
  const max = Math.max(...cycles.map(c => c.completedIssues), 1);

  if (cycles.length === 0) {
    return <p className="py-4 text-center text-xs text-zinc-400">No velocity data yet.</p>;
  }

  return (
    <div className="flex items-end gap-2 h-24 mt-2">
      {cycles.map(c => {
        const pct = max > 0 ? (c.completedIssues / max) * 100 : 0;
        return (
          <div className="flex flex-1 flex-col items-center gap-1" key={c.cycleId}>
            <span className="text-[10px] font-medium text-zinc-500 dark:text-zinc-400">
              {c.completedIssues > 0 ? c.completedIssues : ''}
            </span>
            <div
              className="w-full rounded-t bg-indigo-500"
              style={{
                height: `${Math.max(pct, c.completedIssues > 0 ? 4 : 0)}%`,
                minHeight: c.completedIssues > 0 ? '4px' : '0',
              }}
            />
            <span
              className="max-w-full truncate text-[9px] text-zinc-400"
              title={`Cycle ${c.cycleNumber}`}
            >
              #{c.cycleNumber}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export const CycleDetailView = observer(function CycleDetailView({
  cycleId,
  workspaceKey,
  teamKey,
}: CycleDetailViewProps) {
  const { cycleStore, issueStore, teamStore, workflowStateStore } = useStore();

  const txQueue = useMemo(() => new TransactionQueue(), []);

  const cycle = cycleStore.findById(cycleId);

  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState('');
  const nameInputRef = useRef<HTMLInputElement>(null);

  // Rollover state
  const [rollingOver, setRollingOver] = useState(false);

  // Burndown/burnup state
  const [burndown, setBurndown] = useState<BurndownPoint[] | null>(null);
  const [burndownLoading, setBurndownLoading] = useState(false);
  const [chartView, setChartView] = useState<'burndown' | 'burnup'>('burndown');

  // Scope / carryover metrics
  const [scopeMetrics, setScopeMetrics] = useState<ScopeMetrics | null>(null);

  // Velocity state
  const [velocity, setVelocity] = useState<VelocityResult | null>(null);

  // Focus the name input when editing starts
  useEffect(() => {
    if (editingName) {
      nameInputRef.current?.focus();
    }
  }, [editingName]);

  // Fetch burndown data
  useEffect(() => {
    if (!cycleId) {
      return;
    }
    setBurndownLoading(true);
    gql(CYCLE_BURNDOWN_QUERY, { cycleId })
      .then(res => {
        const points = (res.data?.cycleBurndown ?? []) as BurndownPoint[];
        setBurndown(points);
      })
      .catch(() => setBurndown([]))
      .finally(() => setBurndownLoading(false));
  }, [cycleId]);

  // Fetch scope / carryover metrics
  useEffect(() => {
    if (!cycleId) {
      return;
    }
    gql(CYCLE_SCOPE_METRICS_QUERY, { cycleId })
      .then(res => {
        const m = res.data?.analyticsCycleScopeMetrics as ScopeMetrics | undefined;
        if (m) {
          setScopeMetrics(m);
        }
      })
      .catch(() => {});
  }, [cycleId]);

  // Fetch velocity data
  const teamId = cycle?.teamId;
  useEffect(() => {
    if (!teamId) {
      return;
    }
    gql(CYCLE_VELOCITY_QUERY, { cycleCount: 6, teamId })
      .then(res => {
        const result = res.data?.cycleVelocity as VelocityResult | undefined;
        if (result) {
          setVelocity(result);
        }
      })
      .catch(() => {});
  }, [teamId]);

  const handleRemoveIssue = useCallback(
    (issueId: string) => {
      const snapshot = issueStore.findById(issueId);
      issueStore.optimisticUpdate(issueId, { cycleId: null });
      txQueue.enqueue(
        `mutation CycleRemoveIssue($issueId: ID!) {
          cycleRemoveIssue(issueId: $issueId) { success lastSyncId issue { id cycleId } }
        }`,
        { issueId },
        {
          onError: () => {
            if (snapshot) {
              issueStore.optimisticUpdate(issueId, snapshot);
            }
            toast.error('Failed to remove issue from cycle');
          },
        },
      );
    },
    [issueStore, txQueue],
  );

  const handleRollover = useCallback(async () => {
    if (rollingOver) {
      return;
    }
    setRollingOver(true);
    try {
      const res = await gql(CYCLE_ROLLOVER_MUTATION, { cycleId });
      if (res.errors?.length) {
        toast.error('Failed to roll over cycle');
        return;
      }
      const payload = res.data?.cycleRollover as
        | {
            success: boolean;
            movedCount: number;
            nextCycleId: string | null;
          }
        | undefined;
      if (payload?.success) {
        if (payload.nextCycleId) {
          toast.success(
            `Rolled over. ${payload.movedCount} incomplete issue${payload.movedCount === 1 ? '' : 's'} moved to next cycle.`,
          );
        } else {
          toast.success(
            `${payload.movedCount} issue${payload.movedCount === 1 ? '' : 's'} unassigned.`,
          );
        }
      }
    } catch {
      toast.error('Failed to roll over cycle');
    } finally {
      setRollingOver(false);
    }
  }, [cycleId, rollingOver]);

  if (!cycle) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-zinc-400">
        Cycle not found.
      </div>
    );
  }

  const cycleIssues = issueStore.findByCycleId(cycle.id);
  const completedIssues = cycleIssues.filter(i => i.completedAt);
  const progress =
    cycleIssues.length > 0 ? Math.round((completedIssues.length / cycleIssues.length) * 100) : 0;

  const now = Date.now();
  const startsAtMs = new Date(cycle.startsAt).getTime();
  const endsAtMs = new Date(cycle.endsAt).getTime();
  const isActive = !cycle.completedAt && startsAtMs <= now && endsAtMs > now;
  const isUpcoming = startsAtMs > now;
  const isCompleted = !isActive && !isUpcoming;

  // Show rollover button for active cycles or cycles whose end date has passed
  const showRollover = isActive || endsAtMs <= now;

  const statusLabel = isActive ? 'Active' : isUpcoming ? 'Upcoming' : 'Completed';
  const statusColor = isActive
    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400'
    : isUpcoming
      ? 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-400'
      : 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400';

  const displayName = cycle.name || `Cycle ${cycle.number}`;

  const handleSaveName = () => {
    const trimmed = nameValue.trim();
    setEditingName(false);
    if (!trimmed || trimmed === (cycle.name ?? '')) {
      return;
    }
    const snapshot = { ...cycle };
    cycleStore.optimisticUpdate(cycle.id, { name: trimmed });
    txQueue.enqueue(
      `mutation CycleUpdate($id: ID!, $input: CycleUpdateInput!) {
        cycleUpdate(id: $id, input: $input) { success lastSyncId cycle { id number name description startsAt endsAt progress scope teamId organizationId createdAt updatedAt } }
      }`,
      { id: cycle.id, input: { name: trimmed } },
      {
        onError: () => {
          cycleStore.optimisticUpdate(cycle.id, snapshot);
          toast.error('Failed to update cycle name');
        },
      },
    );
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex h-12 items-center gap-3 border-b border-zinc-200 px-4 dark:border-zinc-800">
        <Link
          className="flex h-6 w-6 items-center justify-center rounded text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
          href={`/${workspaceKey}/team/${teamKey}/cycles`}
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <RefreshCw className="h-4 w-4 text-zinc-400" />
        {editingName ? (
          <input
            className="flex-1 rounded border border-indigo-500 bg-transparent px-1 text-sm font-semibold text-zinc-900 outline-none dark:text-zinc-100"
            onBlur={handleSaveName}
            onChange={e => setNameValue(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                handleSaveName();
              }
              if (e.key === 'Escape') {
                setEditingName(false);
              }
            }}
            ref={nameInputRef}
            type="text"
            value={nameValue}
          />
        ) : (
          <button
            className="text-sm font-semibold text-zinc-900 hover:text-indigo-600 dark:text-zinc-100 dark:hover:text-indigo-400"
            onClick={() => {
              setNameValue(cycle.name ?? '');
              setEditingName(true);
            }}
            title="Click to edit name"
            type="button"
          >
            {displayName}
          </button>
        )}

        {/* Roll over button — only for active / past cycles */}
        {showRollover && (
          <button
            className="ml-auto flex items-center gap-1.5 rounded border border-zinc-200 bg-white px-2.5 py-1 text-xs font-medium text-zinc-600 transition-colors hover:border-zinc-300 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:border-zinc-600 dark:hover:bg-zinc-800"
            disabled={rollingOver}
            onClick={handleRollover}
            type="button"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            {rollingOver ? 'Rolling over…' : 'Roll over'}
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-4xl px-6 py-6">
          {/* Meta info */}
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <span className={cn('rounded-full px-2.5 py-0.5 text-xs font-medium', statusColor)}>
              {statusLabel}
            </span>
            <div className="flex items-center gap-1.5">
              <Calendar className="h-3.5 w-3.5 text-zinc-400" />
              <span className="text-xs text-zinc-500">
                {formatDate(cycle.startsAt)} &rarr; {formatDate(cycle.endsAt)}
              </span>
            </div>
          </div>

          {cycle.description && (
            <p className="mt-4 text-sm text-zinc-600 dark:text-zinc-400">{cycle.description}</p>
          )}

          {/* Progress */}
          <div className="mt-6 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Progress</span>
              <span className="text-xs tabular-nums text-zinc-500">
                {completedIssues.length} / {cycleIssues.length} issues ({progress}%)
              </span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700">
              <div
                className="h-full rounded-full bg-indigo-500 transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>

          {/* Scope creep / carryover metrics */}
          {scopeMetrics &&
            (scopeMetrics.scopeCreepCount > 0 || scopeMetrics.carryoverCount > 0) && (
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
                  <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-400">
                    Planned
                  </p>
                  <p className="mt-1 text-xl font-semibold text-zinc-900 dark:text-zinc-50">
                    {scopeMetrics.plannedCount}
                  </p>
                </div>
                <div className="rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
                  <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-400">
                    Scope creep
                  </p>
                  <p className="mt-1 text-xl font-semibold text-orange-500">
                    {scopeMetrics.scopeCreepCount}
                  </p>
                  <p className="text-[11px] text-zinc-400">
                    {Math.round(scopeMetrics.scopeCreepPct)}% of total
                  </p>
                </div>
                <div className="rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
                  <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-400">
                    Carried over
                  </p>
                  <p className="mt-1 text-xl font-semibold text-blue-500">
                    {scopeMetrics.carryoverCount}
                  </p>
                  <p className="text-[11px] text-zinc-400">
                    {Math.round(scopeMetrics.carryoverPct)}% of total
                  </p>
                </div>
                <div className="rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
                  <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-400">
                    Completed
                  </p>
                  <p className="mt-1 text-xl font-semibold text-green-500">
                    {scopeMetrics.completedCount}
                  </p>
                  <p className="text-[11px] text-zinc-400">of {scopeMetrics.totalCount} total</p>
                </div>
              </div>
            )}

          {/* Burndown / burnup chart — active or completed cycles */}
          {(isActive || isCompleted) && (
            <div className="mt-6 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                  {chartView === 'burndown' ? 'Burndown' : 'Burnup'}
                </h3>
                <div className="flex rounded-md border border-zinc-200 text-xs dark:border-zinc-700">
                  {(['burndown', 'burnup'] as const).map(v => (
                    <button
                      className={cn(
                        'px-2.5 py-1 first:rounded-l last:rounded-r',
                        chartView === v
                          ? 'bg-zinc-100 font-medium text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50'
                          : 'text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200',
                      )}
                      key={v}
                      onClick={() => setChartView(v)}
                      type="button"
                    >
                      {v.charAt(0).toUpperCase() + v.slice(1)}
                    </button>
                  ))}
                </div>
              </div>
              {burndownLoading ? (
                <div className="h-[300px] animate-pulse rounded bg-zinc-100 dark:bg-zinc-800" />
              ) : chartView === 'burndown' ? (
                <BurndownChart data={burndown ?? []} />
              ) : (
                <BurnupChart data={burndown ?? []} />
              )}
            </div>
          )}

          {/* Velocity / capacity section */}
          {velocity && (
            <div className="mt-6 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                Velocity
              </h3>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Avg velocity:{' '}
                <span className="font-medium text-zinc-700 dark:text-zinc-200">
                  {velocity.averageIssues} issues/cycle
                </span>
                {velocity.cycles.length > 0 &&
                  ` (based on last ${velocity.cycles.length} cycle${velocity.cycles.length === 1 ? '' : 's'})`}
              </p>
              {isUpcoming && (
                <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                  Capacity estimate:{' '}
                  <span className="font-medium text-zinc-700 dark:text-zinc-200">
                    ~{velocity.averageIssues} issues
                  </span>
                </p>
              )}
              {velocity.cycles.length > 0 && <VelocityBarChart cycles={velocity.cycles} />}
            </div>
          )}

          {/* Issues */}
          <div className="mt-6">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                Issues ({cycleIssues.length})
              </h3>
            </div>
            <div className="mt-2 flex flex-col gap-0.5">
              {cycleIssues.length === 0 ? (
                <p className="py-8 text-center text-xs text-zinc-400">
                  No issues in this cycle yet. Use{' '}
                  <kbd className="mx-0.5 rounded border px-1 font-mono text-[10px]">Q</kbd> on any
                  issue to assign it to a cycle.
                </p>
              ) : (
                cycleIssues.map(issue => {
                  const state = workflowStateStore.findById(issue.stateId);
                  const team = teamStore.findById(issue.teamId);
                  return (
                    <div
                      className="group flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-900"
                      key={issue.id}
                    >
                      {state && (
                        <span
                          className="h-3 w-3 shrink-0 rounded-full border-2"
                          style={{ borderColor: state.color }}
                        />
                      )}
                      <span className="shrink-0 font-mono text-xs text-zinc-400">
                        {issue.identifier}
                      </span>
                      <Link
                        className="min-w-0 flex-1 truncate text-zinc-900 hover:text-indigo-600 dark:text-zinc-100 dark:hover:text-indigo-400"
                        href={`/${workspaceKey}/team/${team?.key ?? teamKey}`}
                      >
                        {issue.title}
                      </Link>
                      <button
                        className="hidden rounded px-1.5 py-0.5 text-[10px] text-zinc-400 transition-colors hover:bg-zinc-200 hover:text-zinc-600 group-hover:block dark:hover:bg-zinc-700 dark:hover:text-zinc-300"
                        onClick={() => handleRemoveIssue(issue.id)}
                        title="Remove from cycle"
                        type="button"
                      >
                        Remove
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
});
