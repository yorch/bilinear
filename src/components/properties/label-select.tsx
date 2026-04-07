'use client';

import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

interface IssueLabel {
  id: string;
  name: string;
  color: string;
}

interface LabelSelectProps {
  value: string[];
  labels: IssueLabel[];
  onChange: (labelIds: string[]) => void;
  className?: string;
}

export function LabelDot({
  color,
  className,
}: {
  color: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-block h-2 w-2 rounded-full flex-shrink-0',
        className,
      )}
      style={{ backgroundColor: color }}
    />
  );
}

export function LabelSelect({
  value,
  labels,
  onChange,
  className,
}: LabelSelectProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const selected = labels.filter(l => value.includes(l.id));

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const toggle = (labelId: string) => {
    const next = value.includes(labelId)
      ? value.filter(id => id !== labelId)
      : [...value, labelId];
    onChange(next);
  };

  return (
    <div ref={ref} className={cn('relative', className)}>
      <button
        type="button"
        onClick={e => {
          e.stopPropagation();
          setOpen(o => !o);
        }}
        className="flex items-center gap-0.5 rounded px-1.5 py-1 hover:bg-zinc-100 dark:hover:bg-zinc-800"
        title={
          selected.length ? selected.map(l => l.name).join(', ') : 'No labels'
        }
      >
        {selected.length > 0 ? (
          selected.slice(0, 3).map(l => <LabelDot key={l.id} color={l.color} />)
        ) : (
          <span className="text-xs text-zinc-400">Labels</span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 min-w-[200px] rounded-md border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
          {labels.length === 0 && (
            <p className="px-3 py-2 text-sm text-zinc-400">No labels</p>
          )}
          {labels.map(label => (
            <button
              key={label.id}
              type="button"
              onClick={e => {
                e.stopPropagation();
                toggle(label.id);
              }}
              className={cn(
                'flex w-full items-center gap-2 px-3 py-1.5 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800',
                value.includes(label.id) && 'font-medium',
              )}
            >
              <LabelDot color={label.color} />
              {label.name}
              {value.includes(label.id) && (
                <span className="ml-auto text-zinc-400">✓</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
