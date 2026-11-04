import { LoadingRegion, Skeleton } from '@/components/ui/skeleton';

/**
 * Placeholder shown while the lazy TipTap bundle loads (and until the editor
 * instance exists), so an empty-looking body never invites typing nowhere.
 */
export function EditorSkeleton({ compact = false }: { compact?: boolean }) {
  if (compact) {
    // Read-only content (a comment thread renders one editor per comment): a
    // single quiet line, not a `status` region per comment.
    return <Skeleton className="my-1 h-4 w-2/3" />;
  }
  return (
    <LoadingRegion className="flex flex-col gap-2 py-1">
      <Skeleton className="h-4 w-2/3" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-5/6" />
    </LoadingRegion>
  );
}
