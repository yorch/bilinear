'use client';

import { useEffect, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { SelectPopover } from '@/components/ui/select-popover';
import { useTranslations } from '@/hooks/use-translations';
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
    return <span className="text-xs text-muted-foreground">–</span>;
  }

  if (estimationType === 'tShirt') {
    const opt = SCALE_OPTIONS.tShirt.find(o => o.value === value);
    return (
      <Badge className="bg-brand-subtle text-brand-subtle-foreground">{opt?.label ?? value}</Badge>
    );
  }

  return <Badge className="bg-brand-subtle text-brand-subtle-foreground">{value}</Badge>;
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
  const t = useTranslations();
  const scale = SCALE_OPTIONS[estimationType];

  return (
    <SelectPopover
      forceOpen={forceOpen}
      onClose={onClose}
      panelClassName="min-w-[120px] py-1"
      triggerChildren={<EstimateBadge estimationType={estimationType} value={value} />}
      triggerClassName="gap-1 px-1 py-0.5"
      triggerTitle={t('properties.estimate.setEstimate')}
    >
      {close => (
        <>
          {/* Clear estimate */}
          {value != null && (
            <button
              className="w-full px-3 py-1.5 text-left text-xs text-muted-foreground hover:bg-accent"
              onClick={() => {
                onChange(null);
                close();
              }}
              type="button"
            >
              {t('properties.estimate.noEstimate')}
            </button>
          )}

          {scale ? (
            scale.map(opt => (
              <button
                className={cn(
                  'w-full px-3 py-1.5 text-left text-sm transition-colors',
                  value === opt.value
                    ? 'bg-brand-subtle font-medium text-brand-subtle-foreground'
                    : 'text-foreground-secondary hover:bg-accent',
                )}
                key={opt.value}
                onClick={() => {
                  onChange(opt.value);
                  close();
                }}
                type="button"
              >
                {opt.label}
              </button>
            ))
          ) : (
            /* estimationType === 'notUsed' or unknown — free-form number */
            <NumericInput
              onSubmit={v => {
                onChange(v);
                close();
              }}
              value={value ?? undefined}
            />
          )}
        </>
      )}
    </SelectPopover>
  );
}

function NumericInput({
  value,
  onSubmit,
}: {
  value?: number;
  onSubmit: (v: number | null) => void;
}) {
  const t = useTranslations();
  const [draft, setDraft] = useState(value?.toString() ?? '');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div className="px-3 py-2 flex items-center gap-2">
      <input
        className="w-20 rounded border border-border bg-transparent px-2 py-1 text-sm text-foreground outline-none focus:border-brand"
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
        className="rounded bg-primary px-2 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90"
        onClick={() => {
          const n = Number(draft);
          onSubmit(draft === '' ? null : Number.isFinite(n) ? n : null);
        }}
        type="button"
      >
        {t('properties.estimate.set')}
      </button>
    </div>
  );
}
