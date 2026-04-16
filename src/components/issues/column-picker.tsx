'use client';

import { Settings2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
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

  useEffect(() => {
    if (!open) {
      return;
    }
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-label="Column picker"
        aria-expanded={open}
        className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
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
              key={key}
              label={label}
              checked={isVisible(key)}
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
                    key={def.id}
                    label={def.name}
                    checked={isVisible(k)}
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
      <input type="checkbox" checked={checked} onChange={onToggle} />
      {label}
    </label>
  );
}
