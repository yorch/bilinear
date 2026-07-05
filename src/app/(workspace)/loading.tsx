import { IssueListSkeleton, SidebarSkeleton } from '@/components/ui/skeleton';

/**
 * Suspense fallback shown while a workspace route resolves. Approximates
 * the eventual layout (sidebar + content) so users see a stable shell
 * instead of a blank screen during the transition. The real layout
 * mounts as soon as the route finishes loading.
 */
export default function WorkspaceLoading() {
  return (
    <div className="flex h-screen w-screen overflow-hidden">
      <aside className="w-[260px] shrink-0 border-r border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950">
        <SidebarSkeleton />
      </aside>
      <main className="flex flex-1 flex-col">
        <div className="flex h-12 shrink-0 items-center gap-3 border-b border-zinc-200 px-4 dark:border-zinc-800">
          <div className="h-3.5 w-32 animate-pulse rounded-md bg-muted" />
        </div>
        <IssueListSkeleton count={10} />
      </main>
    </div>
  );
}
