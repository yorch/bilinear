'use client';

import { X } from 'lucide-react';
import { priorityLabelKey } from '@/components/properties/priority-icon';
import { StatusDot } from '@/components/properties/status-select';
import { SelectPopover } from '@/components/ui/select-popover';
import { UserAvatar } from '@/components/ui/user-avatar';
import { useTranslations } from '@/hooks/use-translations';
import { getPriorityConfig } from '@/lib/issue-utils';
import type { IssueLabel, IssueUser, WorkflowState } from '@/types/issues';

const PRIORITIES = [0, 1, 2, 3, 4] as const;

interface BulkActionBarProps {
  count: number;
  labels: IssueLabel[];
  onClear: () => void;
  onSelectAll?: () => void;
  onUpdate: (patch: Record<string, unknown>) => void;
  states: WorkflowState[];
  totalCount?: number;
  users: IssueUser[];
}

export function BulkActionBar({
  count,
  states,
  users,
  labels,
  onUpdate,
  onClear,
  onSelectAll,
  totalCount,
}: BulkActionBarProps) {
  const t = useTranslations();
  return (
    <div className="fixed bottom-6 left-1/2 z-50 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 flex-wrap items-center gap-1 rounded-lg border border-zinc-200 bg-white px-3 py-2 shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
      <span className="mr-2 whitespace-nowrap text-sm font-medium text-zinc-700 dark:text-zinc-300">
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
                className="flex w-full items-center gap-2 px-3 py-1.5 text-sm hover:bg-accent"
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
            {PRIORITIES.map(p => {
              const cfg = getPriorityConfig(p);
              return (
                <button
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-sm hover:bg-accent"
                  key={p}
                  onClick={() => {
                    onUpdate({ priority: p });
                    close();
                  }}
                  type="button"
                >
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: cfg.color }}
                  />
                  <span>{t(priorityLabelKey(p))}</span>
                </button>
              );
            })}
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
              className="flex w-full items-center gap-2 px-3 py-1.5 text-sm hover:bg-accent"
              onClick={() => {
                onUpdate({ assigneeId: null });
                close();
              }}
              type="button"
            >
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-zinc-200 text-xs text-zinc-500 dark:bg-zinc-700">
                —
              </span>
              <span>{t('issues.unassigned')}</span>
            </button>
            {users.map(u => (
              <button
                className="flex w-full items-center gap-2 px-3 py-1.5 text-sm hover:bg-accent"
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
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-sm hover:bg-accent"
                  key={l.id}
                  onClick={() => {
                    onUpdate({ labelIds: [l.id] });
                    close();
                  }}
                  type="button"
                >
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: l.color }}
                  />
                  <span className="truncate">{l.name}</span>
                </button>
              ))}
            </div>
          )}
        </SelectPopover>
      )}

      <div className="mx-1 h-4 w-px bg-muted" />

      <button
        aria-label={t('issues.clearSelection')}
        className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
        onClick={onClear}
        title={t('issues.clearSelection')}
        type="button"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
