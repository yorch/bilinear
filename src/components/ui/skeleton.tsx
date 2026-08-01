import { cn } from '@/lib/utils';

/**
 * Base shimmer element. Compose into entity-specific skeletons below.
 */
function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'animate-shimmer rounded-md bg-[linear-gradient(90deg,var(--muted)_0%,var(--accent)_45%,var(--muted)_90%)] bg-[length:200%_100%]',
        className,
      )}
      {...props}
    />
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
    <div className="flex flex-col">
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
    </div>
  );
}

/**
 * Skeleton for the sidebar nav items.
 */
function SidebarSkeleton() {
  return (
    <div className="flex flex-col gap-1 px-2 py-2">
      {Array.from({ length: 5 }).map((_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton list
        <Skeleton className="h-7 w-full rounded-md" key={i} />
      ))}
    </div>
  );
}

/**
 * Skeleton for the issue detail panel (right-side slide-in).
 */
function DetailPanelSkeleton() {
  return (
    <div className="flex flex-col gap-4 p-6">
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
    </div>
  );
}

export { DetailPanelSkeleton, IssueListSkeleton, IssueSkeleton, SidebarSkeleton, Skeleton };
