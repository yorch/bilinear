'use client';

import { X } from 'lucide-react';
import { StatusDot } from '@/components/properties/status-select';
import { SelectPopover } from '@/components/ui/select-popover';
import { getPriorityConfig } from '@/lib/issue-utils';
import type { IssueLabel, IssueUser, WorkflowState } from '@/types/issues';

const PRIORITIES = [0, 1, 2, 3, 4] as const;

interface BulkActionBarProps {
  count: number;
  labels: IssueLabel[];
  onClear: () => void;
  onUpdate: (patch: Record<string, unknown>) => void;
  states: WorkflowState[];
  users: IssueUser[];
}

export function BulkActionBar({
  count,
  states,
  users,
  labels,
  onUpdate,
  onClear,
}: BulkActionBarProps) {
  return (
    <div className="fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-1 rounded-lg border border-zinc-200 bg-white px-3 py-2 shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
      <span className="mr-2 whitespace-nowrap text-sm font-medium text-zinc-700 dark:text-zinc-300">
        {count} selected
      </span>

      <SelectPopover
        triggerChildren={
          <span className="px-2 py-1 text-xs font-medium text-zinc-600 dark:text-zinc-400">
            Status
          </span>
        }
        triggerClassName="rounded border border-zinc-200 dark:border-zinc-700"
      >
        {close => (
          <div className="w-48 py-1">
            {states.map(s => (
              <button
                className="flex w-full items-center gap-2 px-3 py-1.5 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800"
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
          <span className="px-2 py-1 text-xs font-medium text-zinc-600 dark:text-zinc-400">
            Priority
          </span>
        }
        triggerClassName="rounded border border-zinc-200 dark:border-zinc-700"
      >
        {close => (
          <div className="w-40 py-1">
            {PRIORITIES.map(p => {
              const cfg = getPriorityConfig(p);
              return (
                <button
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800"
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
                  <span>{cfg.label}</span>
                </button>
              );
            })}
          </div>
        )}
      </SelectPopover>

      <SelectPopover
        triggerChildren={
          <span className="px-2 py-1 text-xs font-medium text-zinc-600 dark:text-zinc-400">
            Assignee
          </span>
        }
        triggerClassName="rounded border border-zinc-200 dark:border-zinc-700"
      >
        {close => (
          <div className="w-48 py-1">
            <button
              className="flex w-full items-center gap-2 px-3 py-1.5 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800"
              onClick={() => {
                onUpdate({ assigneeId: null });
                close();
              }}
              type="button"
            >
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-zinc-200 text-xs text-zinc-500 dark:bg-zinc-700">
                —
              </span>
              <span>Unassigned</span>
            </button>
            {users.map(u => (
              <button
                className="flex w-full items-center gap-2 px-3 py-1.5 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800"
                key={u.id}
                onClick={() => {
                  onUpdate({ assigneeId: u.id });
                  close();
                }}
                type="button"
              >
                <span
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-medium text-white"
                  style={{ backgroundColor: u.avatarBackgroundColor ?? '#6366f1' }}
                >
                  {u.initials}
                </span>
                <span className="truncate">{u.displayName}</span>
              </button>
            ))}
          </div>
        )}
      </SelectPopover>

      {labels.length > 0 && (
        <SelectPopover
          triggerChildren={
            <span className="px-2 py-1 text-xs font-medium text-zinc-600 dark:text-zinc-400">
              Label
            </span>
          }
          triggerClassName="rounded border border-zinc-200 dark:border-zinc-700"
        >
          {close => (
            <div className="w-48 py-1">
              {labels.map(l => (
                <button
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800"
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

      <div className="mx-1 h-4 w-px bg-zinc-200 dark:bg-zinc-700" />

      <button
        className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
        onClick={onClear}
        title="Clear selection"
        type="button"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
