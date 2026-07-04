'use client';

import { RefreshCw, X } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { Badge } from '@/components/ui/badge';
import { SearchableSelectPopover } from '@/components/ui/searchable-select-popover';
import { useTranslations } from '@/hooks/use-translations';
import { getCycleDisplayName, isActiveCycle } from '@/lib/cycle-utils';
import { useStore } from '@/providers/store-provider';

interface CycleSelectProps {
  onChange: (cycleId: string | null) => void;
  onClose?: () => void;
  open?: boolean;
  teamId: string;
  value: string | null;
}

export const CycleSelect = observer(function CycleSelect({
  value,
  teamId,
  onChange,
  open,
  onClose,
}: CycleSelectProps) {
  const t = useTranslations();
  const { cycleStore } = useStore();
  const cycles = cycleStore.findByTeamId(teamId);
  const current = value ? cycleStore.findById(value) : null;

  return (
    <SearchableSelectPopover
      clearLabel={
        <>
          <X className="h-3 w-3" />
          {t('properties.cycle.removeFromCycle')}
        </>
      }
      emptyText={t('properties.cycle.noCyclesFound')}
      getKey={cycle => cycle.id}
      isSelected={cycle => cycle.id === value}
      items={cycles}
      matchesSearch={(cycle, search) =>
        getCycleDisplayName(cycle).toLowerCase().includes(search.toLowerCase())
      }
      onClear={value ? () => onChange(null) : undefined}
      onClose={onClose}
      onSelect={cycle => onChange(cycle.id)}
      open={open}
      renderItem={cycle => (
        <>
          <RefreshCw className="h-3 w-3 shrink-0 text-zinc-400" />
          <span className="min-w-0 flex-1 truncate text-left">{getCycleDisplayName(cycle)}</span>
          {isActiveCycle(cycle) && (
            <Badge className="shrink-0 bg-emerald-100 px-1.5 text-[10px] text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400">
              {t('properties.cycle.active')}
            </Badge>
          )}
        </>
      )}
      searchPlaceholder={t('properties.cycle.searchPlaceholder')}
      triggerChildren={
        <>
          <RefreshCw className="h-3 w-3" />
          {current ? (
            <span className="max-w-[100px] truncate">{getCycleDisplayName(current)}</span>
          ) : (
            <span className="text-zinc-400">{t('properties.cycle.cycle')}</span>
          )}
        </>
      }
      triggerTitle={t('properties.cycle.setCycle')}
    />
  );
});
