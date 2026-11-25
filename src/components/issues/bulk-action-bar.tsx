'use client';

import { Archive, ArrowLeft, RefreshCw, Trash2, X } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useParams } from 'next/navigation';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { getDueDatePresets } from '@/components/properties/due-date-presets';
import { SCALE_OPTIONS } from '@/components/properties/estimate-picker';
import { PriorityIcon, priorityLabelKey } from '@/components/properties/priority-icon';
import { StatusDot } from '@/components/properties/status-select';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { Calendar } from '@/components/ui/calendar';
import { ColorDot } from '@/components/ui/color-dot';
import { POPOVER_ITEM_CLASS, SelectPopover } from '@/components/ui/select-popover';
import { UserAvatar } from '@/components/ui/user-avatar';
import { useTranslations } from '@/hooks/use-translations';
import { getCycleDisplayName } from '@/lib/cycle-utils';
import { cn, TOUCH_TARGET } from '@/lib/utils';
import { useStore } from '@/providers/store-provider';
import type { IssueLabel, IssueUser, WorkflowState } from '@/types/issues';

const PRIORITIES = [0, 1, 2, 3, 4] as const;

const DUE_PRESET_LABEL = {
  endOfWeek: 'properties.dueDate.endOfWeek',
  nextWeek: 'properties.dueDate.nextWeek',
  today: 'properties.dueDate.today',
  tomorrow: 'properties.dueDate.tomorrow',
} as const;

/**
 * The bar scrolls horizontally on a phone, and a scroll container clips an
 * absolutely-positioned child — so below `md` every panel becomes a fixed
 * sheet floating above the bar instead.
 */
const MOBILE_SHEET =
  'max-md:fixed max-md:inset-x-2 max-md:bottom-[calc(6.5rem+env(safe-area-inset-bottom))] max-md:top-auto max-md:mb-0 max-md:mt-0 max-md:max-h-[min(24rem,calc(100dvh-14rem))] max-md:w-auto max-md:overflow-y-auto';

/**
 * A drill-in that needs its whole body visible (the due-date month grid) lifts
 * the sheet's height cap to what the viewport allows, above the bar, so nothing
 * inside it has to scroll.
 */
const MOBILE_SHEET_TALL = 'max-md:max-h-[calc(100dvh-8rem-env(safe-area-inset-bottom))]';

const ACTION_BUTTON =
  'flex shrink-0 items-center gap-1 rounded border border-border px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground-secondary';

interface BulkActionBarProps {
  count: number;
  /**
   * The team's estimation scale. Supplying it adds an Estimate action — the
   * backlog needs one, and maintained a second bulk bar (with a
   * `window.prompt`) to get it.
   */
  estimationType?: string;
  labels: IssueLabel[];
  /**
   * The checked issues span several teams, so no single cycle list applies.
   * The Cycle action then renders disabled, with a tooltip saying why, rather
   * than silently vanishing.
   */
  mixedTeams?: boolean;
  /** Archive every checked issue. Omitted where the page cannot archive. */
  onArchive?: () => void;
  onClear: () => void;
  /** Permanently delete every checked issue, after a confirmation. Omitted where the page cannot delete. */
  onDelete?: () => void;
  onSelectAll?: () => void;
  onUpdate: (patch: Record<string, unknown>) => void;
  states: WorkflowState[];
  /** Team whose cycles the Cycle action offers; defaults to the team in the route. */
  teamId?: string;
  totalCount?: number;
  users: IssueUser[];
}

/** One trigger + panel; keeps the mobile-sheet contract in a single place. */
function BulkPopover({
  children,
  className,
  label,
  sheetClassName,
  widthClass = 'w-48',
}: {
  children: (close: () => void) => ReactNode;
  className?: string;
  label: string;
  /** Replaces the phone sheet's default height cap (see `MOBILE_SHEET_TALL`). */
  sheetClassName?: string;
  widthClass?: string;
}) {
  return (
    <SelectPopover
      className={cn('shrink-0', className)}
      panelClassName={cn(widthClass, MOBILE_SHEET, sheetClassName)}
      triggerChildren={
        <span className="whitespace-nowrap px-2 py-1 text-xs font-medium text-muted-foreground">
          {label}
        </span>
      }
      triggerClassName="rounded border border-border"
    >
      {close => <div className="py-1">{children(close)}</div>}
    </SelectPopover>
  );
}

interface MoreEntry {
  disabled?: boolean;
  key: string;
  label: string;
  /** Shown only below `md`, where the matching desktop trigger is hidden. */
  mobileOnly?: boolean;
  render: (close: () => void) => ReactNode;
  /** Phone: render the drill-in at full height, with no inner scroll region. */
  tall?: boolean;
  title?: string;
}

/** "More" panel body: a list of actions, each drilling into its own option list. */
function BulkMoreMenu({ close, entries }: { close: () => void; entries: MoreEntry[] }) {
  const t = useTranslations();
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const active = entries.find(e => e.key === activeKey);
  if (active) {
    return (
      <>
        <div className="flex items-center">
          <button
            className="flex min-w-0 flex-1 items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent"
            onClick={() => setActiveKey(null)}
            type="button"
          >
            <ArrowLeft className="h-3 w-3 shrink-0" />
            {active.label}
          </button>
          {/* Phone sheet: an explicit close, since the sheet has no backdrop to tap. */}
          <button
            aria-label={t('common.close')}
            className="mr-1 shrink-0 rounded p-1 text-muted-foreground hover:bg-accent md:hidden"
            onClick={close}
            type="button"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div
          className={cn('border-t border-border', 'max-h-64 overflow-y-auto')}
          data-testid="bulk-more-body"
        >
          {active.render(close)}
        </div>
      </>
    );
  }
  return (
    <>
      {entries.map(e => (
        <button
          className={cn(
            POPOVER_ITEM_CLASS,
            e.mobileOnly && 'md:hidden',
            e.disabled && 'cursor-not-allowed opacity-50 hover:bg-transparent',
          )}
          disabled={e.disabled}
          key={e.key}
          onClick={() => setActiveKey(e.key)}
          title={e.title}
          type="button"
        >
          {e.label}
        </button>
      ))}
    </>
  );
}

export const BulkActionBar = observer(function BulkActionBar({
  count,
  estimationType,
  states,
  users,
  labels,
  mixedTeams,
  onArchive,
  onDelete,
  onUpdate,
  onClear,
  onSelectAll,
  teamId,
  totalCount,
}: BulkActionBarProps) {
  const t = useTranslations();
  const { cycleStore, projectStore, teamStore } = useStore();
  const params = useParams<{ key?: string }>();
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const routeTeam = params?.key ? teamStore.findByKey(params.key) : null;
  const cycleTeamId = teamId ?? routeTeam?.id;
  const cycles = cycleTeamId ? cycleStore.findByTeamId(cycleTeamId) : [];
  const projects = projectStore.all;
  const otherTeams = teamStore.all
    .filter(team => team.id !== cycleTeamId)
    .sort((a, b) => a.name.localeCompare(b.name));

  const renderLabel = (close: () => void) =>
    labels.map(l => (
      <button
        className={POPOVER_ITEM_CLASS}
        key={l.id}
        onClick={() => {
          onUpdate({ labelIds: [l.id] });
          close();
        }}
        type="button"
      >
        <ColorDot color={l.color} />
        <span className="truncate">{l.name}</span>
      </button>
    ));

  const renderProject = (close: () => void) => (
    <>
      <button
        className={POPOVER_ITEM_CLASS}
        onClick={() => {
          onUpdate({ projectId: null, projectMilestoneId: null });
          close();
        }}
        type="button"
      >
        {t('properties.project.removeFromProject')}
      </button>
      {projects.map(p => (
        <button
          className={POPOVER_ITEM_CLASS}
          key={p.id}
          onClick={() => {
            // A milestone belongs to its project, so moving projects clears it.
            onUpdate({ projectId: p.id, projectMilestoneId: null });
            close();
          }}
          type="button"
        >
          <span className="truncate">{p.name}</span>
        </button>
      ))}
    </>
  );

  const renderCycle = (close: () => void) => (
    <>
      <button
        className={POPOVER_ITEM_CLASS}
        onClick={() => {
          onUpdate({ cycleId: null });
          close();
        }}
        type="button"
      >
        {t('properties.cycle.removeFromCycle')}
      </button>
      {cycles.map(c => (
        <button
          className={POPOVER_ITEM_CLASS}
          key={c.id}
          onClick={() => {
            onUpdate({ cycleId: c.id });
            close();
          }}
          type="button"
        >
          <RefreshCw className="h-3 w-3 shrink-0 text-muted-foreground" />
          <span className="truncate">{getCycleDisplayName(c)}</span>
        </button>
      ))}
    </>
  );

  const renderDue = (close: () => void) => (
    <>
      {getDueDatePresets().map(preset => (
        <button
          className={POPOVER_ITEM_CLASS}
          key={preset.key}
          onClick={() => {
            onUpdate({ dueDate: preset.date });
            close();
          }}
          type="button"
        >
          <span className="flex-1 text-left">{t(DUE_PRESET_LABEL[preset.key])}</span>
          <span className="font-mono text-xs text-muted-foreground">{preset.date}</span>
        </button>
      ))}
      <p className="border-t border-border px-3 pt-2 text-xs text-muted-foreground">
        {t('properties.dueDate.orPickDate')}
      </p>
      <Calendar
        onChange={date => {
          onUpdate({ dueDate: date });
          close();
        }}
      />
      <button
        className={POPOVER_ITEM_CLASS}
        onClick={() => {
          onUpdate({ dueDate: null });
          close();
        }}
        type="button"
      >
        {t('properties.dueDate.clearDate')}
      </button>
    </>
  );

  const renderEstimate = (close: () => void) => (
    <>
      <button
        className={POPOVER_ITEM_CLASS}
        onClick={() => {
          onUpdate({ estimate: null });
          close();
        }}
        type="button"
      >
        {t('properties.estimate.noEstimate')}
      </button>
      {(SCALE_OPTIONS[estimationType ?? ''] ?? []).map(opt => (
        <button
          className={POPOVER_ITEM_CLASS}
          key={opt.value}
          onClick={() => {
            onUpdate({ estimate: opt.value });
            close();
          }}
          type="button"
        >
          {opt.label}
        </button>
      ))}
    </>
  );

  const renderTeam = (close: () => void) =>
    otherTeams.map(team => (
      <button
        className={POPOVER_ITEM_CLASS}
        key={team.id}
        onClick={() => {
          onUpdate({ teamId: team.id });
          close();
        }}
        type="button"
      >
        <span className="shrink-0 font-mono text-xs text-muted-foreground">{team.key}</span>
        <span className="truncate">{team.name}</span>
      </button>
    ));

  // Secondary actions live behind "More" so the bar stays a single row on
  // desktop. Label and Due date are primary on desktop but fold in here on a
  // phone (`mobileOnly`), where a third row of triggers would cover the list.
  const moreEntries: MoreEntry[] = [
    ...(labels.length > 0
      ? [{ key: 'label', label: t('issues.label'), mobileOnly: true, render: renderLabel }]
      : []),
    {
      key: 'dueDate',
      label: t('issues.dueDate'),
      mobileOnly: true,
      render: renderDue,
      tall: true,
    },
    ...(projects.length > 0
      ? [{ key: 'project', label: t('issues.project'), render: renderProject }]
      : []),
    ...(mixedTeams
      ? [
          {
            disabled: true,
            key: 'cycle',
            label: t('issues.cycle'),
            render: renderCycle,
            title: t('issues.bulkCycleNeedsSameTeam'),
          },
        ]
      : cycles.length > 0
        ? [{ key: 'cycle', label: t('issues.cycle'), render: renderCycle }]
        : []),
    ...(estimationType && estimationType !== 'notUsed'
      ? [{ key: 'estimate', label: t('issues.estimate'), render: renderEstimate }]
      : []),
    ...(otherTeams.length > 0
      ? [{ key: 'team', label: t('issues.moveToTeam'), render: renderTeam }]
      : []),
  ];

  return (
    <div
      className={cn(
        // Phone: full-width bar of two rows (count, then actions), wrapping if it
        // must so Delete is never scrolled out of sight. md+: the floating card
        // it always was, held to ONE row so Archive/Delete stay with the rest.
        'fixed inset-x-0 bottom-0 z-50 flex max-h-[40vh] flex-wrap items-center md:flex-nowrap gap-1 overflow-y-auto border-t border-border bg-card px-3 py-2 shadow-e3',
        'md:inset-x-auto md:bottom-6 md:left-1/2 md:max-w-[calc(100vw-2rem)] md:-translate-x-1/2 md:max-h-none md:overflow-visible md:rounded-lg md:border md:border-border',
      )}
      data-testid="bulk-action-bar"
    >
      <div className="max-md:flex max-md:w-full max-md:items-center max-md:gap-1 max-md:pr-11 md:contents">
        <span className="mr-2 shrink-0 whitespace-nowrap text-sm font-medium text-foreground-secondary">
          {t('issues.selectedCount', { count })}
        </span>

        {onSelectAll && totalCount !== undefined && count < totalCount && (
          <button
            className="mr-1 shrink-0 whitespace-nowrap rounded px-2 py-1 text-xs font-medium text-primary hover:bg-accent"
            onClick={onSelectAll}
            type="button"
          >
            {t('issues.selectAllCount', { count: totalCount })}
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1 md:contents">
        <BulkPopover label={t('issues.status')}>
          {close =>
            states.map(s => (
              <button
                className={POPOVER_ITEM_CLASS}
                key={s.id}
                onClick={() => {
                  onUpdate({ stateId: s.id });
                  close();
                }}
                type="button"
              >
                <StatusDot color={s.color} />
                <span className="truncate">{s.name}</span>
              </button>
            ))
          }
        </BulkPopover>

        <BulkPopover label={t('issues.priority')} widthClass="w-40">
          {close =>
            PRIORITIES.map(p => (
              <button
                className={POPOVER_ITEM_CLASS}
                key={p}
                onClick={() => {
                  onUpdate({ priority: p });
                  close();
                }}
                type="button"
              >
                <PriorityIcon className="h-3.5 w-3.5" priority={p} />
                <span>{t(priorityLabelKey(p))}</span>
              </button>
            ))
          }
        </BulkPopover>

        <BulkPopover label={t('issues.assignee')}>
          {close => (
            <>
              <button
                className={POPOVER_ITEM_CLASS}
                onClick={() => {
                  onUpdate({ assigneeId: null });
                  close();
                }}
                type="button"
              >
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs text-muted-foreground">
                  —
                </span>
                <span>{t('issues.unassigned')}</span>
              </button>
              {users.map(u => (
                <button
                  className={POPOVER_ITEM_CLASS}
                  key={u.id}
                  onClick={() => {
                    onUpdate({ assigneeId: u.id });
                    close();
                  }}
                  type="button"
                >
                  <UserAvatar size="md" user={u} />
                  <span className="truncate">{u.displayName}</span>
                </button>
              ))}
            </>
          )}
        </BulkPopover>

        {labels.length > 0 && (
          <BulkPopover className="max-md:hidden" label={t('issues.label')}>
            {renderLabel}
          </BulkPopover>
        )}

        <BulkPopover className="max-md:hidden" label={t('issues.dueDate')} widthClass="w-64">
          {renderDue}
        </BulkPopover>

        {moreEntries.length > 0 && (
          <BulkPopover
            label={t('issues.bulkMore')}
            
            widthClass="w-64"
          >
            {close => <BulkMoreMenu close={close} entries={moreEntries} />}
          </BulkPopover>
        )}

        {(onArchive || onDelete) && (
          <div className="flex shrink-0 items-center gap-1 md:ml-1 md:border-l md:border-border md:pl-2">
            {onArchive && (
              <button className={ACTION_BUTTON} onClick={onArchive} type="button">
                <Archive className="h-3.5 w-3.5" />
                <span className="max-md:sr-only">{t('issues.archive')}</span>
              </button>
            )}

            {onDelete && (
              <button
                className={cn(ACTION_BUTTON, 'text-danger-subtle-foreground')}
                onClick={() => setConfirmingDelete(true)}
                type="button"
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span className="max-md:sr-only">{t('common.delete')}</span>
              </button>
            )}
          </div>
        )}
      </div>

      <button
        aria-label={t('issues.clearSelection')}
        className={cn(
          'shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground-secondary',
          'max-md:absolute max-md:right-1 max-md:top-1 md:ml-1',
          TOUCH_TARGET,
        )}
        onClick={onClear}
        title={t('issues.clearSelection')}
        type="button"
      >
        <X className="h-4 w-4" />
      </button>

      <ConfirmDialog
        message={t('issues.bulkDeleteConfirmBody', { count })}
        onCancel={() => setConfirmingDelete(false)}
        onConfirm={() => {
          setConfirmingDelete(false);
          onDelete?.();
        }}
        open={confirmingDelete}
        title={t('issues.bulkDeleteConfirmTitle', { count })}
      />
    </div>
  );
});
