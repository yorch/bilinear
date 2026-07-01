'use client';

import { Settings2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { useOutsideClick } from '@/hooks/use-outside-click';
import type { BuiltInColumn, ColumnKey } from '@/hooks/use-visible-columns';
import type { DBCustomFieldDefinition } from '@/lib/db';

const BUILT_IN_LABELS: { key: BuiltInColumn; label: string }[] = [
  { key: 'labels', label: 'Labels' },
  { key: 'dueDate', label: 'Due date' },
  { key: 'assignee', label: 'Assignee' },
  { key: 'cycle', label: 'Cycle' },
  { key: 'estimate', label: 'Estimate' },
];

export function ColumnPicker({
  isVisible,
  onToggle,
  customFields,
}: {
  isVisible: (key: ColumnKey) => boolean;
  onToggle: (key: ColumnKey) => void;
  customFields?: DBCustomFieldDefinition[];
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useOutsideClick(ref, () => setOpen(false), open, true);

  return (
    <div className="relative" ref={ref}>
      <button
        aria-expanded={open}
        aria-label="Column picker"
        className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
        onClick={() => setOpen(v => !v)}
        type="button"
      >
        <Settings2 className="h-3.5 w-3.5" />
        Columns
      </button>

      {open && (
        <div className="absolute right-0 z-20 mt-1 w-56 rounded-lg border border-zinc-200 bg-white p-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
          <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
            Built-in
          </p>
          {BUILT_IN_LABELS.map(({ key, label }) => (
            <CheckRow
              checked={isVisible(key)}
              key={key}
              label={label}
              onToggle={() => onToggle(key)}
            />
          ))}
          {customFields && customFields.length > 0 && (
            <>
              <p className="mt-1 border-t border-zinc-100 px-2 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-400 dark:border-zinc-800">
                Custom fields
              </p>
              {customFields.map(def => {
                const k: ColumnKey = `custom:${def.id}`;
                return (
                  <CheckRow
                    checked={isVisible(k)}
                    key={def.id}
                    label={def.name}
                    onToggle={() => onToggle(k)}
                  />
                );
              })}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function CheckRow({
  label,
  checked,
  onToggle,
}: {
  label: string;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-800">
      <input checked={checked} onChange={onToggle} type="checkbox" />
      {label}
    </label>
  );
}
