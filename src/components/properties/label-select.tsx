'use client';

import { SelectPopover } from '@/components/ui/select-popover';
import { useTranslations } from '@/hooks/use-translations';
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
  const t = useTranslations();
  const selected = labels.filter(l => value.includes(l.id));

  const toggle = (labelId: string) => {
    const next = value.includes(labelId) ? value.filter(id => id !== labelId) : [...value, labelId];
    onChange(next);
  };

  return (
    <SelectPopover
      align="right"
      className={className}
      forceOpen={forceOpen}
      onClose={onClose}
      panelClassName="min-w-[200px] py-1"
      triggerChildren={
        selected.length > 0 ? (
          selected.slice(0, 3).map(l => <LabelDot color={l.color} key={l.id} />)
        ) : (
          <span className="text-xs text-zinc-400">{t('properties.label.labels')}</span>
        )
      }
      triggerClassName="gap-0.5 px-1.5 py-1"
      triggerTitle={
        selected.length ? selected.map(l => l.name).join(', ') : t('properties.label.noLabels')
      }
    >
      {_close => (
        <>
          {labels.length === 0 && (
            <p className="px-3 py-2 text-sm text-zinc-400">{t('properties.label.noLabels')}</p>
          )}
          {labels.map(label => (
            <button
              className={cn(
                'flex w-full items-center gap-2 px-3 py-1.5 text-sm hover:bg-accent',
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
        </>
      )}
    </SelectPopover>
  );
}
