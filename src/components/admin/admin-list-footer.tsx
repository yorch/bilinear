'use client';

import { Button } from '@/components/ui/button';
import { useTranslations } from '@/hooks/use-translations';

interface AdminListFooterProps {
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  shown: number;
  total: number;
}

/**
 * "Showing N of M" plus a Load more button for the admin lists. Without it a
 * list cut at the server page size reads as the complete set.
 */
export function AdminListFooter({
  hasMore,
  loadingMore,
  onLoadMore,
  shown,
  total,
}: AdminListFooterProps) {
  const t = useTranslations();
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p aria-live="polite" className="text-xs text-muted-foreground">
        {t('admin.list.showing', { shown, total })}
      </p>
      {hasMore && (
        <Button
          disabled={loadingMore}
          onClick={onLoadMore}
          size="sm"
          type="button"
          variant="outline"
        >
          {loadingMore ? t('admin.list.loadingMore') : t('admin.list.loadMore')}
        </Button>
      )}
    </div>
  );
}
