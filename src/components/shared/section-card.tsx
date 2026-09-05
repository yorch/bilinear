import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface SectionCardProps {
  /** Heading level, for document-outline correctness. Defaults to h3. */
  as?: 'h2' | 'h3' | 'h4';
  children: ReactNode;
  className?: string;
  /** One-line explanation under the title. */
  description?: string;
  title: ReactNode;
}

/**
 * A bordered card with a titled header — the container the analytics
 * insight cards, the settings sections and the project property panel all
 * hand-rolled as `rounded-lg border border-border bg-card p-5` plus an
 * `<h3>`. Keeping the frame here means the padding and the heading size stop
 * drifting between siblings on the same page.
 */
export function SectionCard({
  as = 'h3',
  children,
  className,
  description,
  title,
}: SectionCardProps) {
  const Heading = as;
  return (
    <div className={cn('rounded-lg border border-border bg-card p-5', className)}>
      <Heading className="text-sm font-medium text-foreground">{title}</Heading>
      {description && <p className="mt-1 text-xs text-muted-foreground">{description}</p>}
      <div className="mt-3">{children}</div>
    </div>
  );
}
