'use client';

import { Badge } from '@/components/ui/badge';
import { type SelectOption, SimpleSelect } from '@/components/ui/select';
import { roleTone } from '@/lib/role-badges';
import { cn } from '@/lib/utils';

interface RoleSelectProps {
  ariaLabel: string;
  className?: string;
  /** Read-only: the badge still shows the role, the trigger just won't open. */
  disabled?: boolean;
  onChange: (role: string) => void;
  options: readonly SelectOption[];
  value: string;
}

/**
 * A role badge that is its own selector.
 *
 * The workspace roster and team member management both rendered a native
 * `<select>` skinned as a pill, each with its own role → colour map. This is
 * the `Badge` tone from `roleTone` wrapped around a ghost `SimpleSelect`, so
 * the pill reads like every other role chip and the picker behaves like every
 * other select (roving focus, Escape, outside click). The child selector only
 * reaches the trigger — the option panel is a nested `div`, so it keeps the
 * shared popover styling.
 */
export function RoleSelect({
  ariaLabel,
  className,
  disabled = false,
  onChange,
  options,
  value,
}: RoleSelectProps) {
  return (
    <Badge
      className={cn(
        'p-0 [&>div>button]:rounded-full [&>div>button]:px-2 [&>div>button]:py-0.5 [&>div>button]:text-xs [&>div>button]:text-inherit',
        className,
      )}
      tone={roleTone(value)}
    >
      <SimpleSelect
        ariaLabel={ariaLabel}
        disabled={disabled}
        onChange={onChange}
        options={options}
        value={value}
        variant="ghost"
      />
    </Badge>
  );
}
