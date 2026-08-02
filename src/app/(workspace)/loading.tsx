import { IssueListSkeleton, SidebarSkeleton, Skeleton } from '@/components/ui/skeleton';

/**
 * Suspense fallback shown while a workspace route resolves. Approximates
 * the eventual layout (sidebar + content) so users see a stable shell
 * instead of a blank screen during the transition. The real layout
 * mounts as soon as the route finishes loading.
 */
export default function WorkspaceLoading() {
  return (
    <div className="flex h-screen w-screen overflow-hidden">
      <aside className="w-[260px] shrink-0 border-r border-border bg-background">
        <SidebarSkeleton />
      </aside>
      <main className="flex flex-1 flex-col">
        <div className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-4">
          <Skeleton className="h-3.5 w-32" />
        </div>
        <IssueListSkeleton count={10} />
      </main>
    </div>
  );
}
