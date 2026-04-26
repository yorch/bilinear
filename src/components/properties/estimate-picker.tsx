'use client';

import { useEffect, useRef, useState } from 'react';
import { useOutsideClick } from '@/hooks/use-outside-click';
import { cn } from '@/lib/utils';

/** Estimation scale point values per estimation type. */
const SCALE_OPTIONS: Record<string, Array<{ label: string; value: number }>> = {
  exponential: [
    { label: '1', value: 1 },
    { label: '2', value: 2 },
    { label: '4', value: 4 },
    { label: '8', value: 8 },
    { label: '16', value: 16 },
    { label: '32', value: 32 },
  ],
  fibonacci: [
    { label: '1', value: 1 },
    { label: '2', value: 2 },
    { label: '3', value: 3 },
    { label: '5', value: 5 },
    { label: '8', value: 8 },
    { label: '13', value: 13 },
  ],
  linear: [
    { label: '1', value: 1 },
    { label: '2', value: 2 },
    { label: '3', value: 3 },
    { label: '4', value: 4 },
    { label: '5', value: 5 },
  ],
  tShirt: [
    { label: 'XS', value: 1 },
    { label: 'S', value: 2 },
    { label: 'M', value: 3 },
    { label: 'L', value: 4 },
    { label: 'XL', value: 5 },
  ],
};

interface EstimatePickerProps {
  estimationType?: string;
  forceOpen?: boolean;
  /** onChange receives null to clear the estimate */
  onChange: (estimate: number | null) => void;
  onClose?: () => void;
  value?: number | null;
}

/** Render a compact estimate badge/button showing the current value. */
export function EstimateBadge({
  value,
  estimationType,
}: {
  value?: number | null;
  estimationType?: string;
}) {
  if (!value) {
    return <span className="text-xs text-zinc-400 dark:text-zinc-500">–</span>;
  }

  if (estimationType === 'tShirt') {
    const opt = SCALE_OPTIONS.tShirt.find(o => o.value === value);
    return (
      <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300">
        {opt?.label ?? value}
      </span>
    );
  }

  return (
    <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300">
      {value}
    </span>
  );
}

/**
 * Floating dropdown picker for issue estimates. Renders as a badge that opens
 * a popup of scale values. Falls back to a numeric input when no scale applies.
 */
export function EstimatePicker({
  value,
  estimationType = 'notUsed',
  forceOpen,
  onClose,
  onChange,
}: EstimatePickerProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (forceOpen) {
      setOpen(true);
    }
  }, [forceOpen]);

  useOutsideClick(
    containerRef,
    () => {
      setOpen(false);
      onClose?.();
    },
    open,
  );

  const scale = SCALE_OPTIONS[estimationType];

  const handleSelect = (v: number | null) => {
    onChange(v);
    setOpen(false);
    onClose?.();
  };

  return (
    <div className="relative inline-block" ref={containerRef}>
      <button
        aria-label="Set estimate"
        className="flex items-center gap-1 rounded px-1 py-0.5 hover:bg-zinc-100 dark:hover:bg-zinc-800"
        onClick={() => setOpen(v => !v)}
        type="button"
      >
        <EstimateBadge estimationType={estimationType} value={value} />
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 min-w-[120px] rounded-lg border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
          {/* Clear estimate */}
          {value != null && (
            <button
              className="w-full px-3 py-1.5 text-left text-xs text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800"
              onClick={() => handleSelect(null)}
              type="button"
            >
              No estimate
            </button>
          )}

          {scale ? (
            scale.map(opt => (
              <button
                className={cn(
                  'w-full px-3 py-1.5 text-left text-sm transition-colors',
                  value === opt.value
                    ? 'bg-indigo-50 font-medium text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300'
                    : 'text-zinc-700 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-800',
                )}
                key={opt.value}
                onClick={() => handleSelect(opt.value)}
                type="button"
              >
                {opt.label}
              </button>
            ))
          ) : (
            /* estimationType === 'notUsed' or unknown — free-form number */
            <NumericInput onSubmit={v => handleSelect(v)} value={value ?? undefined} />
          )}
        </div>
      )}
    </div>
  );
}

function NumericInput({
  value,
  onSubmit,
}: {
  value?: number;
  onSubmit: (v: number | null) => void;
}) {
  const [draft, setDraft] = useState(value?.toString() ?? '');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div className="px-3 py-2 flex items-center gap-2">
      <input
        className="w-20 rounded border border-zinc-200 bg-transparent px-2 py-1 text-sm text-zinc-900 outline-none focus:border-indigo-500 dark:border-zinc-700 dark:text-zinc-100"
        min={0}
        onChange={e => setDraft(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') {
            const n = Number(draft);
            onSubmit(draft === '' ? null : Number.isFinite(n) ? n : null);
          }
          if (e.key === 'Escape') {
            onSubmit(value ?? null);
          }
        }}
        placeholder="0"
        ref={inputRef}
        step={1}
        type="number"
        value={draft}
      />
      <button
        className="rounded bg-indigo-600 px-2 py-1 text-xs font-medium text-white hover:bg-indigo-700"
        onClick={() => {
          const n = Number(draft);
          onSubmit(draft === '' ? null : Number.isFinite(n) ? n : null);
        }}
        type="button"
      >
        Set
      </button>
    </div>
  );
}
