import { cva, type VariantProps } from 'class-variance-authority';
import type * as React from 'react';

import { cn } from '@/lib/utils';

const badgeVariants = cva('inline-flex items-center gap-1 text-xs font-medium', {
  defaultVariants: { tone: 'none', variant: 'pill' },
  variants: {
    /**
     * Colour. Defaults to `none` so the many call sites that pass their own
     * colours through `className` (label chips carrying a user-chosen colour,
     * status pills driven by workflow state) keep working untouched — this is
     * additive, not a re-skin.
     */
    tone: {
      brand: 'bg-brand-subtle text-brand-subtle-foreground',
      danger: 'bg-danger-subtle text-danger-subtle-foreground',
      info: 'bg-info-subtle text-info-subtle-foreground',
      muted: 'bg-muted text-muted-foreground',
      none: '',
      outline: 'border border-border text-foreground-secondary',
      success: 'bg-success-subtle text-success-subtle-foreground',
      warning: 'bg-warning-subtle text-warning-subtle-foreground',
    },
    variant: {
      pill: 'rounded-full px-2 py-0.5',
      solid: 'rounded px-1.5 py-0.5 text-white',
    },
  },
});

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone, variant }), className)} {...props} />;
}

export { badgeVariants };
