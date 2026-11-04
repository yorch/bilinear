'use client';

import { ColorDot } from '@/components/ui/color-dot';
import { SearchableSelectPopover } from '@/components/ui/searchable-select-popover';
import { useTranslations } from '@/hooks/use-translations';
import { cn, TOUCH_TARGET } from '@/lib/utils';

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
    <SearchableSelectPopover
      className={className}
      emptyText={t('properties.status.noStatusesFound')}
      forceOpen={forceOpen}
      getKey={state => state.id}
      isSelected={state => state.id === value}
      items={states}
      matchesSearch={(state, search) => state.name.toLowerCase().includes(search.toLowerCase())}
      onClose={onClose}
      onSelect={state => onChange(state.id)}
      panelClassName="min-w-[200px]"
      panelDataTestId="status-select-popover"
      renderItem={state => (
        <>
          <StatusDot color={state.color} />
          {state.name}
        </>
      )}
      searchPlaceholder={t('properties.status.searchPlaceholder')}
      triggerChildren={
        <>
          {current && <StatusDot color={current.color} />}
          <span className="text-muted-foreground">{current?.name ?? '—'}</span>
        </>
      }
      triggerClassName={cn('gap-1.5 px-1.5 py-1 text-xs', TOUCH_TARGET, 'max-md:justify-start')}
      triggerTitle={current?.name ?? t('properties.status.status')}
    />
  );
}
