'use client';

import { ArrowLeft, Calendar, MoreHorizontal, RefreshCw, RotateCcw } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BurndownChart } from '@/components/cycles/burndown-chart';
import { BurnupChart } from '@/components/cycles/burnup-chart';
import { isValidCycleRange } from '@/components/cycles/create-cycle-modal';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { InlineRetry } from '@/components/shared/inline-retry';
import { fromDateInputValue, toDateInputValue } from '@/components/teams/team-settings-helpers';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ProgressBar } from '@/components/ui/progress-bar';
import { POPOVER_ITEM_CLASS, SelectPopover } from '@/components/ui/select-popover';
import { LoadingRegion, Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { useDocumentTitle } from '@/hooks/use-document-title';
import { useFormatters } from '@/hooks/use-formatters';
import { useRetryableFetch } from '@/hooks/use-retryable-fetch';
import { useTranslations } from '@/hooks/use-translations';
import { isActiveCycle } from '@/lib/cycle-utils';
import { gql, gqlMutate, gqlQuery } from '@/lib/graphql';
import {
  CYCLE_ARCHIVE_MUTATION,
  CYCLE_BURNDOWN_QUERY,
  CYCLE_DELETE_MUTATION,
  CYCLE_PROGRESS_QUERY,
  CYCLE_ROLLOVER_MUTATION,
  CYCLE_SCOPE_METRICS_QUERY,
  CYCLE_UPDATE_MUTATION,
  CYCLE_VELOCITY_QUERY,
} from '@/lib/graphql-queries';
import { toast } from '@/lib/toast';
import { TransactionQueue } from '@/lib/transaction-queue';
import { cn, getErrorMessage, TOUCH_TARGET, TOUCH_TARGET_SQUARE } from '@/lib/utils';
import { useStore } from '@/providers/store-provider';

interface CycleDetailViewProps {
  cycleId: string;
  teamKey: string;
  workspaceKey: string;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface BurndownPoint {
  completed: number;
  date: string;
  remaining: number;
  scope: number;
}

interface ServerProgress {
  progress: number;
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
// Velocity bar chart (CSS, same pattern as analytics page)
// ---------------------------------------------------------------------------

interface VelocityBarChartProps {
  cycles: VelocityCycle[];
}

function VelocityBarChart({ cycles }: VelocityBarChartProps) {
  const t = useTranslations();
  const max = Math.max(...cycles.map(c => c.completedIssues), 1);

  if (cycles.length === 0) {
    return (
      <p className="py-4 text-center text-xs text-muted-foreground">
        {t('cycles.detail.velocity.empty')}
      </p>
    );
  }

  return (
    <div className="flex items-end gap-2 h-24 mt-2">
      {cycles.map(c => {
        const pct = max > 0 ? (c.completedIssues / max) * 100 : 0;
        return (
          <div className="flex flex-1 flex-col items-center gap-1" key={c.cycleId}>
            <span className="text-[10px] font-medium text-muted-foreground">
              {c.completedIssues > 0 ? c.completedIssues : ''}
            </span>
            <div
              className="w-full rounded-t bg-brand"
              style={{
                height: `${Math.max(pct, c.completedIssues > 0 ? 4 : 0)}%`,
                minHeight: c.completedIssues > 0 ? '4px' : '0',
              }}
            />
            <span
              className="max-w-full truncate text-[9px] text-muted-foreground"
              title={t('cycles.defaultName', { number: c.cycleNumber })}
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
  const t = useTranslations();
  const { formatDate } = useFormatters();
  const router = useRouter();

  const txQueue = useMemo(() => new TransactionQueue(), []);

  const cycle = cycleStore.findById(cycleId);

  useDocumentTitle(cycle ? cycle.name || t('cycles.defaultName', { number: cycle.number }) : null);

  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState('');
  const nameInputRef = useRef<HTMLInputElement>(null);

  const [editingDescription, setEditingDescription] = useState(false);
  const [descriptionValue, setDescriptionValue] = useState('');
  const [editingDates, setEditingDates] = useState(false);
  const [startValue, setStartValue] = useState('');
  const [endValue, setEndValue] = useState('');
  const [confirmAction, setConfirmAction] = useState<'archive' | 'delete' | null>(null);
  const [acting, setActing] = useState(false);

  // Rollover state
  const [rollingOver, setRollingOver] = useState(false);

  const [chartView, setChartView] = useState<'burndown' | 'burnup'>('burndown');

  // Focus the name input when editing starts
  useEffect(() => {
    if (editingName) {
      nameInputRef.current?.focus();
    }
  }, [editingName]);

  // Burndown/burnup data. A rejected read renders a retry instead of a blank
  // chart, which reads as "no work was done this cycle".
  const {
    data: burndown,
    error: burndownError,
    loading: burndownLoading,
    refetch: fetchBurndown,
  } = useRetryableFetch<BurndownPoint[] | null>(
    () => gqlQuery<BurndownPoint[] | null>(CYCLE_BURNDOWN_QUERY, { cycleId }, 'cycleBurndown'),
    [cycleId],
    null,
  );

  // Server-resolved progress. Deliberately not derived from `issueStore`:
  // that pool holds only the issues this client happens to have, and a guest
  // is scoped to issues they created or are assigned — so one owned issue in
  // a 50-issue cycle used to render as 100%.
  const { data: serverProgress } = useRetryableFetch<ServerProgress | null>(
    () => gqlQuery<ServerProgress | null>(CYCLE_PROGRESS_QUERY, { id: cycleId }, 'cycle'),
    [cycleId],
    null,
  );

  // Scope / carryover metrics
  const {
    data: scopeMetrics,
    error: scopeMetricsError,
    refetch: fetchScopeMetrics,
  } = useRetryableFetch<ScopeMetrics | null>(
    () =>
      gqlQuery<ScopeMetrics | null>(
        CYCLE_SCOPE_METRICS_QUERY,
        { cycleId },
        'analyticsCycleScopeMetrics',
      ),
    [cycleId],
    null,
  );

  // Velocity data — keyed on the cycle's team, which isn't known until the
  // cycle itself has loaded into the store.
  const teamId = cycle?.teamId;
  const {
    data: velocity,
    error: velocityError,
    refetch: fetchVelocity,
  } = useRetryableFetch<VelocityResult | null>(
    () =>
      teamId
        ? gqlQuery<VelocityResult | null>(
            CYCLE_VELOCITY_QUERY,
            { cycleCount: 6, teamId },
            'cycleVelocity',
          )
        : Promise.resolve(null),
    [teamId],
    null,
  );

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
            toast.error(t('cycles.detail.removeIssueError'));
          },
        },
      );
    },
    [issueStore, txQueue, t],
  );

  const handleRollover = useCallback(async () => {
    if (rollingOver) {
      return;
    }
    setRollingOver(true);
    try {
      const res = await gql(CYCLE_ROLLOVER_MUTATION, { cycleId });
      if (res.errors?.length) {
        toast.error(t('cycles.detail.rolloverError'));
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
          toast.success(t('cycles.detail.rolledOver', { count: payload.movedCount }));
        } else {
          toast.success(t('cycles.detail.unassigned', { count: payload.movedCount }));
        }
      }
    } catch {
      toast.error(t('cycles.detail.rolloverError'));
    } finally {
      setRollingOver(false);
    }
  }, [cycleId, rollingOver, t]);

  if (!cycle) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        {t('cycles.detail.notFound')}
      </div>
    );
  }

  // The issue *list* below renders from the local pool — that is the set this
  // client can actually link to. The progress *stat* must not come from it:
  // see the `serverProgress` fetch above. Until it lands the bar reads 0,
  // which is the same thing the (never-written) `cycles.progress` column used
  // to report forever.
  const cycleIssues = issueStore.findByCycleId(cycle.id);
  const scopeCount = serverProgress?.scope ?? 0;
  const completedCount = Math.round((serverProgress?.progress ?? 0) * scopeCount);
  const progress = Math.round((serverProgress?.progress ?? 0) * 100);

  const now = Date.now();
  const startsAtMs = new Date(cycle.startsAt).getTime();
  const endsAtMs = new Date(cycle.endsAt).getTime();
  const isActive = isActiveCycle(cycle);
  const isUpcoming = startsAtMs > now;
  const isCompleted = !isActive && !isUpcoming;

  // Show rollover button for active cycles or cycles whose end date has passed
  const showRollover = isActive || endsAtMs <= now;

  const statusLabel = isActive
    ? t('cycles.status.active')
    : isUpcoming
      ? t('cycles.status.upcoming')
      : t('cycles.status.completed');
  const statusColor = isActive
    ? 'bg-success-subtle text-success-subtle-foreground'
    : isUpcoming
      ? 'bg-info-subtle text-info-subtle-foreground'
      : 'bg-muted text-muted-foreground';

  const displayName = cycle.name || t('cycles.defaultName', { number: cycle.number });
  const listHref = `/${workspaceKey}/team/${teamKey}/cycles`;

  /** Optimistic patch + queued mutation, rolled back with a toast on failure. */
  const patchCycle = (patch: Partial<typeof cycle>, errorKey: string) => {
    const snapshot = { ...cycle };
    cycleStore.optimisticUpdate(cycle.id, patch);
    txQueue.enqueue(
      CYCLE_UPDATE_MUTATION,
      { id: cycle.id, input: patch },
      {
        onError: () => {
          cycleStore.optimisticUpdate(cycle.id, snapshot);
          toast.error(t(errorKey));
        },
      },
    );
  };

  const handleSaveName = () => {
    const trimmed = nameValue.trim();
    setEditingName(false);
    if (!trimmed || trimmed === (cycle.name ?? '')) {
      return;
    }
    patchCycle({ name: trimmed }, 'cycles.detail.updateNameError');
  };

  const handleSaveDescription = () => {
    const trimmed = descriptionValue.trim();
    setEditingDescription(false);
    if (trimmed === (cycle.description ?? '')) {
      return;
    }
    patchCycle({ description: trimmed || null }, 'cycles.detail.updateDescriptionError');
    toast.success(t('cycles.detail.descriptionSaved'));
  };

  const datesValid = isValidCycleRange(startValue, endValue);

  const handleSaveDates = () => {
    if (!datesValid) {
      return;
    }
    const startsAt = fromDateInputValue(startValue);
    const endsAt = fromDateInputValue(endValue, true);
    setEditingDates(false);
    if (!startsAt || !endsAt || (startsAt === cycle.startsAt && endsAt === cycle.endsAt)) {
      return;
    }
    patchCycle({ endsAt, startsAt }, 'cycles.detail.updateDatesError');
    toast.success(t('cycles.detail.datesSaved'));
  };

  const handleArchive = async () => {
    setConfirmAction(null);
    setActing(true);
    try {
      const data = await gqlMutate(CYCLE_ARCHIVE_MUTATION, { id: cycle.id });
      const archived = (data.cycleArchive as { cycle?: typeof cycle } | undefined)?.cycle;
      cycleStore.applySyncAction(
        'A',
        cycle.id,
        archived ?? { ...cycle, archivedAt: new Date().toISOString() },
      );
      toast.success(t('cycles.detail.archived'));
      router.push(listHref);
    } catch (err) {
      toast.error(getErrorMessage(err, t('cycles.detail.archiveError')));
    } finally {
      setActing(false);
    }
  };

  const handleDelete = async () => {
    setConfirmAction(null);
    setActing(true);
    try {
      await gqlMutate(CYCLE_DELETE_MUTATION, { id: cycle.id });
      cycleStore.applySyncAction('D', cycle.id, null);
      toast.success(t('cycles.detail.deleted'));
      router.push(listHref);
    } catch (err) {
      toast.error(getErrorMessage(err, t('cycles.detail.deleteError')));
    } finally {
      setActing(false);
    }
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex h-12 items-center gap-3 border-b border-border px-4">
        <Link
          className={cn(
            'flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground-secondary',
            TOUCH_TARGET_SQUARE,
          )}
          href={`/${workspaceKey}/team/${teamKey}/cycles`}
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <RefreshCw className="h-4 w-4 text-muted-foreground" />
        {editingName ? (
          <input
            className="flex-1 rounded border border-brand bg-transparent px-1 text-sm font-semibold text-foreground outline-none"
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
            className="text-sm font-semibold text-foreground hover:text-brand"
            onClick={() => {
              setNameValue(cycle.name ?? '');
              setEditingName(true);
            }}
            title={t('cycles.detail.clickToEditName')}
            type="button"
          >
            {displayName}
          </button>
        )}

        <div className="ml-auto flex items-center gap-2">
          {/* Roll over button — only for active / past cycles */}
          {showRollover && (
            <button
              className="flex items-center gap-1.5 rounded border border-border bg-card px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent disabled:opacity-50"
              disabled={rollingOver}
              onClick={handleRollover}
              type="button"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              {rollingOver ? t('cycles.detail.rollingOver') : t('cycles.detail.rollOver')}
            </button>
          )}
          <SelectPopover
            align="right"
            disabled={acting}
            panelClassName="min-w-[160px] py-1"
            triggerChildren={<MoreHorizontal className="h-4 w-4" />}
            triggerClassName={cn(
              'rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground-secondary',
              TOUCH_TARGET,
            )}
            triggerTitle={t('cycles.detail.moreActions')}
          >
            {close => (
              <>
                <button
                  className={POPOVER_ITEM_CLASS}
                  onClick={() => {
                    setConfirmAction('archive');
                    close();
                  }}
                  type="button"
                >
                  {t('cycles.detail.archive')}
                </button>
                <button
                  className={cn(POPOVER_ITEM_CLASS, 'text-danger-subtle-foreground')}
                  onClick={() => {
                    setConfirmAction('delete');
                    close();
                  }}
                  type="button"
                >
                  {t('cycles.detail.delete')}
                </button>
              </>
            )}
          </SelectPopover>
        </div>
      </div>

      <ConfirmDialog
        confirmLabel={t('cycles.detail.archive')}
        message={t('cycles.detail.archiveConfirm', { name: displayName })}
        onCancel={() => setConfirmAction(null)}
        onConfirm={() => void handleArchive()}
        open={confirmAction === 'archive'}
        title={t('cycles.detail.archiveTitle')}
      />
      <ConfirmDialog
        confirmLabel={t('cycles.detail.delete')}
        message={t('cycles.detail.deleteConfirm', { name: displayName })}
        onCancel={() => setConfirmAction(null)}
        onConfirm={() => void handleDelete()}
        open={confirmAction === 'delete'}
        title={t('cycles.detail.deleteTitle')}
      />

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-4xl px-6 py-6">
          {/* Meta info */}
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <span className={cn('rounded-full px-2.5 py-0.5 text-xs font-medium', statusColor)}>
              {statusLabel}
            </span>
            {editingDates ? (
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  aria-label={t('cycles.create.startDate')}
                  className="w-auto"
                  onChange={e => setStartValue(e.target.value)}
                  type="date"
                  value={startValue}
                />
                <span className="text-xs text-muted-foreground">&rarr;</span>
                <Input
                  aria-label={t('cycles.create.endDate')}
                  className="w-auto"
                  onChange={e => setEndValue(e.target.value)}
                  type="date"
                  value={endValue}
                />
                <Button
                  onClick={() => setEditingDates(false)}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  {t('common.cancel')}
                </Button>
                <Button disabled={!datesValid} onClick={handleSaveDates} size="sm" type="button">
                  {t('common.save')}
                </Button>
              </div>
            ) : (
              <button
                className="flex items-center gap-1.5 rounded px-1 py-0.5 hover:bg-muted"
                onClick={() => {
                  setStartValue(toDateInputValue(cycle.startsAt));
                  setEndValue(toDateInputValue(cycle.endsAt));
                  setEditingDates(true);
                }}
                title={t('cycles.detail.clickToEditDates')}
                type="button"
              >
                <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">
                  {formatDate(cycle.startsAt, { day: 'numeric', month: 'short', year: 'numeric' })}{' '}
                  &rarr;{' '}
                  {formatDate(cycle.endsAt, { day: 'numeric', month: 'short', year: 'numeric' })}
                </span>
              </button>
            )}
          </div>

          {editingDescription ? (
            <Textarea
              aria-label={t('cycles.create.description')}
              autoFocus
              className="mt-4 resize-none"
              onBlur={handleSaveDescription}
              onChange={e => setDescriptionValue(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Escape') {
                  setEditingDescription(false);
                }
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  handleSaveDescription();
                }
              }}
              placeholder={t('cycles.create.descriptionPlaceholder')}
              rows={3}
              value={descriptionValue}
            />
          ) : (
            <button
              className={cn(
                'mt-4 block w-full rounded px-1 py-0.5 text-left text-sm hover:bg-muted',
                cycle.description ? 'text-muted-foreground' : 'text-foreground-faint',
              )}
              onClick={() => {
                setDescriptionValue(cycle.description ?? '');
                setEditingDescription(true);
              }}
              title={t('cycles.detail.clickToEditDescription')}
              type="button"
            >
              {cycle.description || t('cycles.detail.addDescription')}
            </button>
          )}

          {/* Progress */}
          <div className="mt-6 rounded-lg border border-border p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">
                {t('cycles.detail.progress')}
              </span>
              <span className="text-xs tabular-nums text-muted-foreground">
                {t('cycles.detail.progressCount', {
                  completed: completedCount,
                  progress,
                  total: scopeCount,
                })}
              </span>
            </div>
            <ProgressBar className="mt-2 h-2" value={progress} />
          </div>

          {/* Scope creep / carryover metrics */}
          {scopeMetricsError && (
            <InlineRetry message={t('common.somethingWentWrong')} onRetry={fetchScopeMetrics} />
          )}
          {scopeMetrics &&
            (scopeMetrics.scopeCreepCount > 0 || scopeMetrics.carryoverCount > 0) && (
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="rounded-lg border border-border bg-card p-3">
                  <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    {t('cycles.detail.scope.planned')}
                  </p>
                  <p className="mt-1 text-xl font-semibold text-foreground">
                    {scopeMetrics.plannedCount}
                  </p>
                </div>
                <div className="rounded-lg border border-border bg-card p-3">
                  <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    {t('cycles.detail.scope.creep')}
                  </p>
                  <p className="mt-1 text-xl font-semibold text-warning-subtle-foreground">
                    {scopeMetrics.scopeCreepCount}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {t('cycles.detail.scope.pctOfTotal', {
                      pct: Math.round(scopeMetrics.scopeCreepPct),
                    })}
                  </p>
                </div>
                <div className="rounded-lg border border-border bg-card p-3">
                  <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    {t('cycles.detail.scope.carriedOver')}
                  </p>
                  <p className="mt-1 text-xl font-semibold text-info-subtle-foreground">
                    {scopeMetrics.carryoverCount}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {t('cycles.detail.scope.pctOfTotal', {
                      pct: Math.round(scopeMetrics.carryoverPct),
                    })}
                  </p>
                </div>
                <div className="rounded-lg border border-border bg-card p-3">
                  <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    {t('cycles.detail.scope.completed')}
                  </p>
                  <p className="mt-1 text-xl font-semibold text-success-subtle-foreground">
                    {scopeMetrics.completedCount}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {t('cycles.detail.scope.ofTotal', { total: scopeMetrics.totalCount })}
                  </p>
                </div>
              </div>
            )}

          {/* Burndown / burnup chart — active or completed cycles */}
          {(isActive || isCompleted) && (
            <div className="mt-6 rounded-lg border border-border p-4">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {chartView === 'burndown' ? t('cycles.burndown.title') : t('cycles.burnup.title')}
                </h3>
                <div className="flex rounded-md border border-border text-xs">
                  {(['burndown', 'burnup'] as const).map(v => (
                    <button
                      className={cn(
                        'px-2.5 py-1 first:rounded-l last:rounded-r',
                        chartView === v
                          ? 'bg-muted font-medium text-foreground'
                          : 'text-muted-foreground hover:text-foreground',
                      )}
                      key={v}
                      onClick={() => setChartView(v)}
                      type="button"
                    >
                      {v === 'burndown' ? t('cycles.burndown.title') : t('cycles.burnup.title')}
                    </button>
                  ))}
                </div>
              </div>
              {burndownLoading ? (
                <LoadingRegion>
                  <Skeleton className="h-[300px]" />
                </LoadingRegion>
              ) : burndownError ? (
                <InlineRetry message={t('common.somethingWentWrong')} onRetry={fetchBurndown} />
              ) : chartView === 'burndown' ? (
                <BurndownChart data={burndown ?? []} />
              ) : (
                <BurnupChart data={burndown ?? []} />
              )}
            </div>
          )}

          {/* Velocity / capacity section */}
          {velocityError && (
            <div className="mt-6 rounded-lg border border-border p-4">
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {t('cycles.detail.velocity.title')}
              </h3>
              <InlineRetry message={t('common.somethingWentWrong')} onRetry={fetchVelocity} />
            </div>
          )}
          {velocity && (
            <div className="mt-6 rounded-lg border border-border p-4">
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {t('cycles.detail.velocity.title')}
              </h3>
              <p className="text-xs text-muted-foreground">
                {t('cycles.detail.velocity.avgLabel')}{' '}
                <span className="font-medium text-foreground">
                  {t('cycles.detail.velocity.issuesPerCycle', { count: velocity.averageIssues })}
                </span>
                {velocity.cycles.length > 0 &&
                  ` (${t('cycles.detail.velocity.basedOnLast', { count: velocity.cycles.length })})`}
              </p>
              {isUpcoming && (
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {t('cycles.detail.velocity.capacityLabel')}{' '}
                  <span className="font-medium text-foreground">
                    {t('cycles.detail.velocity.approxIssues', { count: velocity.averageIssues })}
                  </span>
                </p>
              )}
              {velocity.cycles.length > 0 && <VelocityBarChart cycles={velocity.cycles} />}
            </div>
          )}

          {/* Issues */}
          <div className="mt-6">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {t('cycles.detail.issuesHeading', { count: cycleIssues.length })}
              </h3>
            </div>
            <div className="mt-2 flex flex-col gap-0.5">
              {cycleIssues.length === 0 ? (
                <p className="py-8 text-center text-xs text-muted-foreground">
                  {t('cycles.detail.noIssuesBefore')}{' '}
                  <kbd className="mx-0.5 rounded border px-1 font-mono text-[10px]">Q</kbd>{' '}
                  {t('cycles.detail.noIssuesAfter')}
                </p>
              ) : (
                cycleIssues.map(issue => {
                  const state = workflowStateStore.findById(issue.stateId);
                  const team = teamStore.findById(issue.teamId);
                  return (
                    <div
                      className="group flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors hover:bg-accent"
                      key={issue.id}
                    >
                      {state && (
                        <span
                          className="h-3 w-3 shrink-0 rounded-full border-2"
                          style={{ borderColor: state.color }}
                        />
                      )}
                      <span className="shrink-0 font-mono text-xs text-muted-foreground">
                        {issue.identifier}
                      </span>
                      <Link
                        className="min-w-0 flex-1 truncate text-foreground hover:text-brand"
                        href={`/${workspaceKey}/team/${team?.key ?? teamKey}`}
                      >
                        {issue.title}
                      </Link>
                      <button
                        className="hidden rounded px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground-secondary group-hover:block"
                        onClick={() => handleRemoveIssue(issue.id)}
                        title={t('cycles.detail.removeFromCycle')}
                        type="button"
                      >
                        {t('cycles.detail.remove')}
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
