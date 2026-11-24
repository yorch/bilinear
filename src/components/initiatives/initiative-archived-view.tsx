'use client';

import { Archive, Flag, Undo2 } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useState } from 'react';
import {
  ARCHIVED_INITIATIVES_QUERY,
  INITIATIVE_UNARCHIVE_MUTATION,
} from '@/components/initiatives/initiative-mutations';
import { InlineRetry } from '@/components/shared/inline-retry';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { RowsSkeleton } from '@/components/ui/skeleton';
import { useArchivedLoad } from '@/hooks/use-archived-load';
import { useTranslations } from '@/hooks/use-translations';
import type { DBInitiative } from '@/lib/db';
import { gqlMutate, gqlQuery } from '@/lib/graphql';
import { toast } from '@/lib/toast';
import { useStore } from '@/providers/store-provider';

/**
 * Archived initiatives with a Restore on each. Archived rows are not in the
 * bootstrap, so they are fetched when this view opens, seeded into the store
 * (the GraphQL type carries every column the store reads) and read back from
 * there — which also folds in anything archived earlier this session. Restore is
 * optimistic: the row leaves at once and returns with a toast if the server
 * refuses.
 */
export const InitiativeArchivedView = observer(function InitiativeArchivedView() {
  const t = useTranslations();
  const { initiativeStore } = useStore();
  const [restoringIds, setRestoringIds] = useState<Set<string>>(new Set());

  const load = useArchivedLoad<DBInitiative>(
    true,
    () =>
      gqlQuery<DBInitiative[]>(ARCHIVED_INITIATIVES_QUERY, {}, 'initiatives').then(rows =>
        rows.filter(r => r.archivedAt),
      ),
    rows => initiativeStore.upsertMany(rows.map(r => ({ ...r, prioritySortOrder: 0 }))),
  );
  const rows = initiativeStore.archived;

  const restore = async (row: DBInitiative) => {
    setRestoringIds(prev => new Set(prev).add(row.id));
    initiativeStore.optimisticUpdate(row.id, { archivedAt: null });
    try {
      await gqlMutate(INITIATIVE_UNARCHIVE_MUTATION, { id: row.id });
      toast.success(t('initiatives.row.restored', { name: row.name }));
    } catch {
      initiativeStore.optimisticUpdate(row.id, { archivedAt: row.archivedAt });
      toast.error(t('initiatives.row.unarchiveFailed'));
    } finally {
      setRestoringIds(prev => {
        const next = new Set(prev);
        next.delete(row.id);
        return next;
      });
    }
  };

  if (load.error) {
    return <InlineRetry message={t('initiatives.page.loadArchivedFailed')} onRetry={load.retry} />;
  }
  if (load.loading && rows.length === 0) {
    return <RowsSkeleton className="px-4 py-4" count={4} />;
  }
  if (rows.length === 0) {
    return (
      <EmptyState
        description={t('initiatives.page.archivedEmptyDescription')}
        icon={<Archive className="h-5 w-5" />}
        testId="empty-state"
        title={t('initiatives.page.archivedEmptyTitle')}
      />
    );
  }

  return (
    <ul className="flex flex-col" data-testid="archived-initiatives">
      {rows.map(row => (
        <li className="flex items-center gap-3 border-b border-border px-4 py-3" key={row.id}>
          <Flag className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate text-sm text-foreground">{row.name}</span>
          <Button
            disabled={restoringIds.has(row.id)}
            onClick={() => void restore(row)}
            size="sm"
            variant="outline"
          >
            <Undo2 className="h-3.5 w-3.5" />
            {t('common.restore')}
          </Button>
        </li>
      ))}
    </ul>
  );
});
