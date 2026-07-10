'use client';

import { useId } from 'react';
import { Switch } from '@/components/ui/switch';

interface SettingToggleRowProps {
  checked: boolean;
  description: string;
  disabled?: boolean;
  label: string;
  onCheckedChange: (checked: boolean) => void;
}

/**
 * Label + description + Switch row, used across settings pages. The
 * whole row is a <label> (not just the switch) so clicking the
 * description also toggles it.
 */
export function SettingToggleRow({
  label,
  description,
  checked,
  onCheckedChange,
  disabled,
}: SettingToggleRowProps) {
  const id = useId();
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4" htmlFor={id}>
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground">{label}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <Switch checked={checked} disabled={disabled} id={id} onCheckedChange={onCheckedChange} />
    </label>
  );
}
