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
        'w-full rounded-md border border-zinc-200 bg-transparent px-3 py-1.5 text-sm text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-100',
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
