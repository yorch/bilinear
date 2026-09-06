import { forwardRef, type InputHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

type CheckboxProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>;

/**
 * Native checkbox with the repo's control styling: `accent-brand` follows the
 * user's accent like every other brand role, `border-input` is the ≥3:1
 * control boundary. A native input rather than a re-implemented one so label
 * association, `indeterminate` and form submission keep working for free.
 */
const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(({ className, ...props }, ref) => (
  <input
    className={cn(
      'h-4 w-4 shrink-0 cursor-pointer rounded border-input accent-brand',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
      'disabled:cursor-not-allowed disabled:opacity-50',
      className,
    )}
    ref={ref}
    type="checkbox"
    {...props}
  />
));
Checkbox.displayName = 'Checkbox';

export { Checkbox };
