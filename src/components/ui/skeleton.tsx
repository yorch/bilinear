'use client';

import { useTranslations } from '@/hooks/use-translations';
import { cn } from '@/lib/utils';

/**
 * Base shimmer element. Compose into entity-specific skeletons below.
 *
 * `aria-hidden`: a shimmer bar is a picture of content that hasn't arrived,
 * and announcing a stack of empty divs is noise. The composite skeletons
 * below carry the announcement instead — see `LoadingRegion`.
 */
function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        'animate-shimmer rounded-md bg-[linear-gradient(90deg,var(--muted)_0%,var(--accent)_45%,var(--muted)_90%)] bg-[length:200%_100%]',
        className,
      )}
      {...props}
    />
  );
}

/**
 * Announces that content is loading.
 *
 * The pages these skeletons replaced rendered the literal string "Loading…",
 * which a screen reader read out. Swapping in a purely visual shimmer removed
 * that announcement entirely and left non-sighted users with silence — the
 * regression this wrapper exists to undo. `aria-busy` marks the region as
 * in-flight; the sr-only text gives the live region something to say.
 */
function LoadingRegion({ children, className }: { children: React.ReactNode; className?: string }) {
  const t = useTranslations();
  return (
    <div aria-busy="true" className={className} role="status">
      <span className="sr-only">{t('common.loading')}</span>
      {children}
    </div>
  );
}

/**
 * Skeleton for a single issue row in the list view.
 * Matches the approximate shape of IssueRow.
 */
function IssueSkeleton() {
  return (
    <div className="flex items-center gap-3 px-4 py-2">
      <Skeleton className="h-4 w-4 shrink-0 rounded-full" />
      <Skeleton className="h-3.5 w-14 shrink-0" />
      <Skeleton className="h-3.5 flex-1" />
      <Skeleton className="h-3.5 w-20 shrink-0" />
      <Skeleton className="h-5 w-5 shrink-0 rounded-full" />
    </div>
  );
}

/**
 * Several issue rows stacked — used while the bootstrap sync is in-flight.
 */
function IssueListSkeleton({ count = 8 }: { count?: number }) {
  return (
    <LoadingRegion className="flex flex-col">
      {/* Group header shimmer */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border">
        <Skeleton className="h-3 w-3 rounded-full" />
        <Skeleton className="h-3.5 w-24" />
        <Skeleton className="h-4 w-6 rounded-full ml-1" />
      </div>
      {Array.from({ length: count }).map((_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton list
        <IssueSkeleton key={i} />
      ))}
    </LoadingRegion>
  );
}

/**
 * Skeleton for the sidebar nav items.
 */
function SidebarSkeleton() {
  return (
    <LoadingRegion className="flex flex-col gap-1 px-2 py-2">
      {Array.from({ length: 5 }).map((_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton list
        <Skeleton className="h-7 w-full rounded-md" key={i} />
      ))}
    </LoadingRegion>
  );
}

/**
 * Skeleton for the issue detail panel (right-side slide-in).
 */
function DetailPanelSkeleton() {
  return (
    <LoadingRegion className="flex flex-col gap-4 p-6">
      <Skeleton className="h-6 w-3/4" />
      <Skeleton className="h-4 w-1/3" />
      <div className="flex flex-col gap-2 mt-2">
        {Array.from({ length: 5 }).map((_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton list
          <div className="flex items-center gap-3" key={i}>
            <Skeleton className="h-4 w-24 shrink-0" />
            <Skeleton className="h-4 w-32" />
          </div>
        ))}
      </div>
      <div className="mt-4 flex flex-col gap-2">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
        <Skeleton className="h-4 w-4/6" />
      </div>
    </LoadingRegion>
  );
}

/**
 * Generic stacked rows, for a list or table section that is still loading.
 * Widths vary so it reads as content rather than a progress bar.
 */
function RowsSkeleton({ className, count = 5 }: { className?: string; count?: number }) {
  const widths = ['w-11/12', 'w-9/12', 'w-10/12', 'w-8/12', 'w-11/12', 'w-7/12'];
  return (
    <LoadingRegion className={cn('flex flex-col gap-3', className)}>
      {Array.from({ length: count }).map((_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton list
        <Skeleton className={cn('h-4', widths[i % widths.length])} key={i} />
      ))}
    </LoadingRegion>
  );
}

/**
 * Whole-page fallback for routes that gate their entire render on a fetch —
 * a header bar plus rows, so the chrome doesn't pop in after the body.
 */
function PageSkeleton({ count = 6 }: { count?: number }) {
  // RowsSkeleton is its own LoadingRegion, so this composes the visual only —
  // one announcement per loading surface, not two.
  return (
    <div className="flex flex-1 flex-col">
      <div
        aria-hidden="true"
        className="flex min-h-12 items-center gap-3 border-b border-border px-4 py-2"
      >
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-4 w-8" />
      </div>
      <RowsSkeleton className="p-4" count={count} />
    </div>
  );
}

export {
  DetailPanelSkeleton,
  IssueListSkeleton,
  IssueSkeleton,
  LoadingRegion,
  PageSkeleton,
  RowsSkeleton,
  SidebarSkeleton,
  Skeleton,
};
