'use client';

import { Diamond, X } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { SearchableSelectPopover } from '@/components/ui/searchable-select-popover';
import { useTranslations } from '@/hooks/use-translations';
import { useStore } from '@/providers/store-provider';

interface MilestoneSelectProps {
  onChange: (milestoneId: string | null) => void;
  onClose?: () => void;
  open?: boolean;
  /** Milestones belong to a project; without one the picker is disabled. */
  projectId: string | null | undefined;
  value: string | null;
}

/**
 * Project-milestone picker for an issue. Lists only the milestones of the
 * issue's project — a milestone from another project is never a valid target.
 */
export const MilestoneSelect = observer(function MilestoneSelect({
  value,
  projectId,
  onChange,
  open,
  onClose,
}: MilestoneSelectProps) {
  const t = useTranslations();
  const { projectStore } = useStore();
  const milestones = projectId ? projectStore.getMilestones(projectId) : [];
  const current = value ? projectStore.findMilestoneById(value) : null;

  return (
    <SearchableSelectPopover
      clearLabel={
        <>
          <X className="h-3 w-3" />
          {t('properties.milestone.clear')}
        </>
      }
      disabled={!projectId}
      emptyText={t('properties.milestone.noMilestones')}
      getKey={m => m.id}
      isSelected={m => m.id === value}
      items={milestones}
      matchesSearch={(m, search) => m.name.toLowerCase().includes(search.toLowerCase())}
      onClear={value ? () => onChange(null) : undefined}
      onClose={onClose}
      onSelect={m => onChange(m.id)}
      open={open}
      renderItem={m => (
        <>
          <Diamond className="h-3 w-3 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate text-left">{m.name}</span>
        </>
      )}
      searchPlaceholder={t('properties.milestone.searchPlaceholder')}
      triggerChildren={
        <>
          <Diamond className="h-3 w-3" />
          {current ? (
            <span className="max-w-[120px] truncate">{current.name}</span>
          ) : (
            <span className="text-muted-foreground">{t('properties.milestone.milestone')}</span>
          )}
        </>
      }
      triggerTitle={
        projectId ? t('properties.milestone.setMilestone') : t('properties.milestone.needsProject')
      }
    />
  );
});
