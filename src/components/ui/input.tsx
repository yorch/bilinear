'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Text input matching the app's form-field convention (previously
 * copy-pasted per modal). Pass `aria-label` or pair with a <label htmlFor>.
 */
const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type = 'text', ...props }, ref) => (
    <input
      className={cn(
        // Focus is a brand ring plus a soft glow rather than a 1px outline —
        // the accent's main job in the chrome, and the same treatment the
        // selection rail uses so focus and selection read as one language.
        'w-full rounded-md border border-input bg-transparent px-3 py-1.5 text-sm text-foreground outline-none transition-[border-color,box-shadow] duration-150 ease-crisp placeholder:text-muted-foreground focus:border-ring focus:shadow-[0_0_0_3px_var(--brand-subtle)] disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      ref={ref}
      type={type}
      {...props}
    />
  ),
);
Input.displayName = 'Input';

export { Input };
