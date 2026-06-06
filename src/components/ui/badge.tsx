import { cva, type VariantProps } from 'class-variance-authority';
import type * as React from 'react';

import { cn } from '@/lib/utils';

const badgeVariants = cva('inline-flex items-center gap-1 text-xs font-medium', {
  defaultVariants: { variant: 'pill' },
  variants: {
    variant: {
      pill: 'rounded-full px-2 py-0.5',
      solid: 'rounded px-1.5 py-0.5 text-white',
    },
  },
});

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { badgeVariants };
