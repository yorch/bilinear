'use client';

import { TriageKeyHint } from '@/components/issues/triage-key-hint';
import { buttonVariants } from '@/components/ui/button';
import { POPOVER_ITEM_CLASS, SelectPopover } from '@/components/ui/select-popover';
import { useTranslations } from '@/hooks/use-translations';
import { cn, TOUCH_TARGET } from '@/lib/utils';

export const SNOOZE_PRESETS: ReadonlyArray<{ hours: number; labelKey: string }> = [
  { hours: 4, labelKey: 'settings.triage.snooze4Hours' },
  { hours: 24, labelKey: 'settings.triage.snooze1Day' },
  { hours: 168, labelKey: 'settings.triage.snooze1Week' },
];

interface TriageSnoozeMenuProps {
  disabled: boolean;
  /** One-shot open, driven by the H / S shortcut. */
  forceOpen?: boolean;
  onClose?: () => void;
  onSelect: (hours: number) => void;
  /** Override the preset list (tests; a future per-team setting). */
  presets?: ReadonlyArray<{ hours: number; labelKey: string }>;
}

/**
 * Snooze presets on the shared `SelectPopover`: it owns outside-click, an
 * Escape that is claimed (one Escape closes one surface), arrow-key roving
 * focus and focus-on-open. Rows are keyed by preset hours — stable identities,
 * so the panel never remounts under a pointer that is mid-click.
 */
export function TriageSnoozeMenu({
  disabled,
  forceOpen,
  onClose,
  onSelect,
  presets = SNOOZE_PRESETS,
}: TriageSnoozeMenuProps) {
  const t = useTranslations();
  return (
    <SelectPopover
      disabled={disabled}
      forceOpen={forceOpen}
      listbox
      onClose={onClose}
      panelClassName="min-w-36 py-1"
      triggerChildren={
        <>
          {t('settings.triage.snooze')}
          <TriageKeyHint>H</TriageKeyHint>
        </>
      }
      triggerClassName={cn(buttonVariants({ size: 'sm', variant: 'outline' }), TOUCH_TARGET)}
    >
      {close =>
        presets.map(p => (
          <button
            aria-selected={false}
            className={POPOVER_ITEM_CLASS}
            key={p.hours}
            onClick={() => {
              close();
              onSelect(p.hours);
            }}
            role="option"
            type="button"
          >
            {t(p.labelKey)}
          </button>
        ))
      }
    </SelectPopover>
  );
}
