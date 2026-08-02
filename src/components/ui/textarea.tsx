'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

/** Multi-line counterpart to the Input primitive; same field convention. */
const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    className={cn(
      // Matches Input's focus treatment exactly — see the note there.
      'w-full rounded-md border border-input bg-transparent px-3 py-1.5 text-sm text-foreground outline-none transition-[border-color,box-shadow] duration-150 ease-crisp placeholder:text-muted-foreground focus:border-ring focus:shadow-[0_0_0_3px_var(--brand-subtle)] disabled:cursor-not-allowed disabled:opacity-50',
      className,
    )}
    ref={ref}
    {...props}
  />
));
Textarea.displayName = 'Textarea';

export { Textarea };
