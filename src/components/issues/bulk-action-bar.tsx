'use client';

import { Archive, X } from 'lucide-react';
import { SCALE_OPTIONS } from '@/components/properties/estimate-picker';
import { PriorityIcon, priorityLabelKey } from '@/components/properties/priority-icon';
import { StatusDot } from '@/components/properties/status-select';
import { ColorDot } from '@/components/ui/color-dot';
import { POPOVER_ITEM_CLASS, SelectPopover } from '@/components/ui/select-popover';
import { UserAvatar } from '@/components/ui/user-avatar';
import { useTranslations } from '@/hooks/use-translations';
import { cn, TOUCH_TARGET } from '@/lib/utils';
import type { IssueLabel, IssueUser, WorkflowState } from '@/types/issues';

const PRIORITIES = [0, 1, 2, 3, 4] as const;

interface BulkActionBarProps {
  count: number;
  /**
   * The team's estimation scale. Supplying it adds an Estimate action — the
   * backlog needs one, and maintained a second bulk bar (with a
   * `window.prompt`) to get it.
   */
  estimationType?: string;
  labels: IssueLabel[];
  /** Archive every checked issue. Omitted where the page cannot archive. */
  onArchive?: () => void;
  onClear: () => void;
  onSelectAll?: () => void;
  onUpdate: (patch: Record<string, unknown>) => void;
  states: WorkflowState[];
  totalCount?: number;
  users: IssueUser[];
}

export function BulkActionBar({
  count,
  estimationType,
  states,
  users,
  labels,
  onArchive,
  onUpdate,
  onClear,
  onSelectAll,
  totalCount,
}: BulkActionBarProps) {
  const t = useTranslations();
  return (
    <div className="fixed bottom-6 left-1/2 z-50 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 flex-wrap items-center gap-1 rounded-lg border border-border bg-card px-3 py-2 shadow-e3">
      <span className="mr-2 whitespace-nowrap text-sm font-medium text-foreground-secondary">
        {t('issues.selectedCount', { count })}
      </span>

      {onSelectAll && totalCount !== undefined && count < totalCount && (
        <button
          className="mr-1 whitespace-nowrap rounded px-2 py-1 text-xs font-medium text-primary hover:bg-accent"
          onClick={onSelectAll}
          type="button"
        >
          {t('issues.selectAllCount', { count: totalCount })}
        </button>
      )}

      <SelectPopover
        triggerChildren={
          <span className="px-2 py-1 text-xs font-medium text-muted-foreground">
            {t('issues.status')}
          </span>
        }
        triggerClassName="rounded border border-border"
      >
        {close => (
          <div className="w-48 py-1">
            {states.map(s => (
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
            ))}
          </div>
        )}
      </SelectPopover>

      <SelectPopover
        triggerChildren={
          <span className="px-2 py-1 text-xs font-medium text-muted-foreground">
            {t('issues.priority')}
          </span>
        }
        triggerClassName="rounded border border-border"
      >
        {close => (
          <div className="w-40 py-1">
            {PRIORITIES.map(p => (
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
            ))}
          </div>
        )}
      </SelectPopover>

      <SelectPopover
        triggerChildren={
          <span className="px-2 py-1 text-xs font-medium text-muted-foreground">
            {t('issues.assignee')}
          </span>
        }
        triggerClassName="rounded border border-border"
      >
        {close => (
          <div className="w-48 py-1">
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
          </div>
        )}
      </SelectPopover>

      {labels.length > 0 && (
        <SelectPopover
          triggerChildren={
            <span className="px-2 py-1 text-xs font-medium text-muted-foreground">
              {t('issues.label')}
            </span>
          }
          triggerClassName="rounded border border-border"
        >
          {close => (
            <div className="w-48 py-1">
              {labels.map(l => (
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
              ))}
            </div>
          )}
        </SelectPopover>
      )}

      {estimationType && estimationType !== 'notUsed' && (
        <SelectPopover
          triggerChildren={
            <span className="px-2 py-1 text-xs font-medium text-muted-foreground">
              {t('issues.estimate')}
            </span>
          }
          triggerClassName="rounded border border-border"
        >
          {close => (
            <div className="w-32 py-1">
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
              {(SCALE_OPTIONS[estimationType] ?? []).map(opt => (
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
            </div>
          )}
        </SelectPopover>
      )}

      {onArchive && (
        <button
          className="flex items-center gap-1 rounded border border-border px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground-secondary"
          onClick={onArchive}
          type="button"
        >
          <Archive className="h-3.5 w-3.5" />
          {t('issues.archive')}
        </button>
      )}

      <div className="mx-1 h-4 w-px bg-muted" />

      <button
        aria-label={t('issues.clearSelection')}
        className={cn(
          'rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground-secondary',
          TOUCH_TARGET,
        )}
        onClick={onClear}
        title={t('issues.clearSelection')}
        type="button"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
