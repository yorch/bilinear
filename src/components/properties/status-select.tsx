'use client';

import { ColorDot } from '@/components/ui/color-dot';
import { POPOVER_ITEM_CLASS, SelectPopover } from '@/components/ui/select-popover';
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
  return <ColorDot className={className} color={color} size="md" />;
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
      listbox
      onClose={onClose}
      panelClassName="min-w-[160px] py-1"
      panelDataTestId="status-select-popover"
      triggerChildren={
        <>
          {current && <StatusDot color={current.color} />}
          <span className="text-muted-foreground">{current?.name ?? '—'}</span>
        </>
      }
      triggerClassName="gap-1.5 px-1.5 py-1 text-xs"
      triggerTitle={current?.name ?? t('properties.status.status')}
    >
      {close =>
        states.map(state => (
          <button
            aria-selected={state.id === value}
            className={cn(POPOVER_ITEM_CLASS, state.id === value && 'font-medium')}
            key={state.id}
            onClick={e => {
              e.stopPropagation();
              onChange(state.id);
              close();
            }}
            role="option"
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
