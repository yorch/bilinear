'use client';

import { useEffect, useRef, useState } from 'react';
import { useOutsideClick } from '@/hooks/use-outside-click';
import { cn } from '@/lib/utils';

interface IssueLabel {
  color: string;
  id: string;
  name: string;
}

interface LabelSelectProps {
  className?: string;
  forceOpen?: boolean;
  labels: IssueLabel[];
  onChange: (labelIds: string[]) => void;
  onClose?: () => void;
  value: string[];
}

export function LabelDot({ color, className }: { color: string; className?: string }) {
  return (
    <span
      className={cn('inline-block h-2 w-2 rounded-full flex-shrink-0', className)}
      style={{ backgroundColor: color }}
    />
  );
}

export function LabelSelect({
  value,
  labels,
  onChange,
  className,
  forceOpen,
  onClose,
}: LabelSelectProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const selected = labels.filter(l => value.includes(l.id));

  useEffect(() => {
    if (forceOpen) {
      setOpen(true);
    }
  }, [forceOpen]);

  useOutsideClick(
    ref,
    () => {
      setOpen(false);
      onClose?.();
    },
    open,
  );

  const toggle = (labelId: string) => {
    const next = value.includes(labelId) ? value.filter(id => id !== labelId) : [...value, labelId];
    onChange(next);
  };

  return (
    <div className={cn('relative', className)} ref={ref}>
      <button
        className="flex items-center gap-0.5 rounded px-1.5 py-1 hover:bg-zinc-100 dark:hover:bg-zinc-800"
        onClick={e => {
          e.stopPropagation();
          setOpen(o => !o);
        }}
        title={selected.length ? selected.map(l => l.name).join(', ') : 'No labels'}
        type="button"
      >
        {selected.length > 0 ? (
          selected.slice(0, 3).map(l => <LabelDot color={l.color} key={l.id} />)
        ) : (
          <span className="text-xs text-zinc-400">Labels</span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 min-w-[200px] rounded-md border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
          {labels.length === 0 && <p className="px-3 py-2 text-sm text-zinc-400">No labels</p>}
          {labels.map(label => (
            <button
              className={cn(
                'flex w-full items-center gap-2 px-3 py-1.5 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800',
                value.includes(label.id) && 'font-medium',
              )}
              key={label.id}
              onClick={e => {
                e.stopPropagation();
                toggle(label.id);
              }}
              type="button"
            >
              <LabelDot color={label.color} />
              {label.name}
              {value.includes(label.id) && <span className="ml-auto text-zinc-400">✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
