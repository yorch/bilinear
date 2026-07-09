'use client';

import { Settings2 } from 'lucide-react';
import { SelectPopover } from '@/components/ui/select-popover';
import { useTranslations } from '@/hooks/use-translations';
import type { BuiltInColumn, ColumnKey } from '@/hooks/use-visible-columns';
import type { DBCustomFieldDefinition } from '@/lib/db';

export function ColumnPicker({
  isVisible,
  onToggle,
  customFields,
}: {
  isVisible: (key: ColumnKey) => boolean;
  onToggle: (key: ColumnKey) => void;
  customFields?: DBCustomFieldDefinition[];
}) {
  const t = useTranslations();

  const BUILT_IN_LABELS: { key: BuiltInColumn; label: string }[] = [
    { key: 'labels', label: t('issues.labels') },
    { key: 'dueDate', label: t('issues.dueDate') },
    { key: 'assignee', label: t('issues.assignee') },
    { key: 'cycle', label: t('issues.cycle') },
    { key: 'estimate', label: t('issues.estimate') },
  ];

  return (
    <SelectPopover
      align="right"
      panelClassName="w-56 p-1"
      triggerChildren={
        <>
          <Settings2 className="h-3.5 w-3.5" />
          {t('issues.columns')}
        </>
      }
      triggerClassName="gap-1 px-2 py-1 text-xs text-muted-foreground hover:text-foreground-secondary"
      triggerTitle={t('issues.columnPicker')}
    >
      {() => (
        <>
          <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            {t('issues.builtIn')}
          </p>
          {BUILT_IN_LABELS.map(({ key, label }) => (
            <CheckRow
              checked={isVisible(key)}
              key={key}
              label={label}
              onToggle={() => onToggle(key)}
            />
          ))}
          {customFields && customFields.length > 0 && (
            <>
              <p className="mt-1 border-t border-border px-2 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {t('issues.customFields')}
              </p>
              {customFields.map(def => {
                const k: ColumnKey = `custom:${def.id}`;
                return (
                  <CheckRow
                    checked={isVisible(k)}
                    key={def.id}
                    label={def.name}
                    onToggle={() => onToggle(k)}
                  />
                );
              })}
            </>
          )}
        </>
      )}
    </SelectPopover>
  );
}

function CheckRow({
  label,
  checked,
  onToggle,
}: {
  label: string;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-xs text-foreground-secondary hover:bg-muted">
      <input checked={checked} onChange={onToggle} type="checkbox" />
      {label}
    </label>
  );
}
