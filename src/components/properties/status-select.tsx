'use client';

import { SelectPopover } from '@/components/ui/select-popover';
import { useTranslations } from '@/hooks/use-translations';
import { cn } from '@/lib/utils';

interface WorkflowState {
  color: string;
  id: string;
  name: string;
  type: string;
}

interface StatusSelectProps {
  className?: string;
  forceOpen?: boolean;
  onChange: (stateId: string) => void;
  onClose?: () => void;
  states: WorkflowState[];
  value: string;
}

export function StatusDot({ color, className }: { color: string; className?: string }) {
  return (
    <span
      className={cn('inline-block h-2.5 w-2.5 rounded-full flex-shrink-0', className)}
      style={{ backgroundColor: color }}
    />
  );
}

export function StatusSelect({
  value,
  states,
  onChange,
  className,
  forceOpen,
  onClose,
}: StatusSelectProps) {
  const t = useTranslations();
  const current = states.find(s => s.id === value);

  return (
    <SelectPopover
      className={className}
      forceOpen={forceOpen}
      onClose={onClose}
      panelClassName="min-w-[160px] py-1"
      panelDataTestId="status-select-popover"
      triggerChildren={
        <>
          {current && <StatusDot color={current.color} />}
          <span className="text-zinc-600 dark:text-zinc-400">{current?.name ?? '—'}</span>
        </>
      }
      triggerClassName="gap-1.5 px-1.5 py-1 text-xs"
      triggerTitle={current?.name ?? t('properties.status.status')}
    >
      {close =>
        states.map(state => (
          <button
            className={cn(
              'flex w-full items-center gap-2 px-3 py-1.5 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800',
              state.id === value && 'font-medium',
            )}
            key={state.id}
            onClick={e => {
              e.stopPropagation();
              onChange(state.id);
              close();
            }}
            type="button"
          >
            <StatusDot color={state.color} />
            {state.name}
          </button>
        ))
      }
    </SelectPopover>
  );
}
