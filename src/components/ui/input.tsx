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
        'w-full rounded-md border border-input bg-transparent px-3 py-1.5 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-ring focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
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
