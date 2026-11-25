'use client';

import { Archive, RefreshCw, Undo2 } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useState } from 'react';
import { ARCHIVED_CYCLES_QUERY } from '@/components/cycles/cycle-mutations';
import { useCycleArchive } from '@/components/cycles/use-cycle-archive';
import { InlineRetry } from '@/components/shared/inline-retry';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { RowsSkeleton } from '@/components/ui/skeleton';
import { useArchivedLoad } from '@/hooks/use-archived-load';
import { useFormatters } from '@/hooks/use-formatters';
import { useTranslations } from '@/hooks/use-translations';
import type { DBCycle } from '@/lib/db';
import { gqlQuery } from '@/lib/graphql';
import { useStore } from '@/providers/store-provider';

/**
 * Archived cycles of one team with a Restore on each. Fetched when the view
 * opens, seeded into the store and read back from there, so a restore (an
 * `archivedAt` patch) moves the row to the Active view with no second path.
 */
export const CycleArchivedView = observer(function CycleArchivedView({
  teamId,
}: {
  teamId: string;
}) {
  const t = useTranslations();
  const { formatDate } = useFormatters();
  const { cycleStore } = useStore();
  const { restore } = useCycleArchive();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const handleRestore = async (cycle: DBCycle) => {
    if (pendingId) {
      return;
    }
    setPendingId(cycle.id);
    try {
      await restore(cycle);
    } finally {
      setPendingId(null);
    }
  };

  const load = useArchivedLoad<DBCycle>(
    true,
    () =>
      gqlQuery<DBCycle[]>(ARCHIVED_CYCLES_QUERY, { teamId }, 'cycles').then(rows =>
        rows.filter(c => c.archivedAt),
      ),
    rows => cycleStore.upsertMany(rows),
  );
  const rows = cycleStore.archived.filter(c => c.teamId === teamId);

  if (load.error) {
    return <InlineRetry message={t('cycles.list.loadArchivedFailed')} onRetry={load.retry} />;
  }
  if (load.loading && rows.length === 0) {
    return <RowsSkeleton className="px-4 py-4" count={4} />;
  }
  if (rows.length === 0) {
    return (
      <EmptyState
        description={t('cycles.list.archivedEmptyDescription')}
        icon={<Archive className="h-5 w-5" />}
        testId="empty-state"
        title={t('cycles.list.archivedEmptyTitle')}
      />
    );
  }

  return (
    <ul className="flex flex-col" data-testid="archived-cycles">
      {rows.map(cycle => (
        <li className="flex items-center gap-3 border-b border-border px-3 py-2.5" key={cycle.id}>
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-muted text-muted-foreground">
            <RefreshCw className="h-3.5 w-3.5" />
          </span>
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-sm text-foreground">
              {cycle.name || t('cycles.defaultName', { number: cycle.number })}
            </span>
            <span className="text-xs text-muted-foreground">
              {formatDate(cycle.startsAt, { day: 'numeric', month: 'short', year: 'numeric' })}
              {' – '}
              {formatDate(cycle.endsAt, { day: 'numeric', month: 'short', year: 'numeric' })}
            </span>
          </div>
          <Button
            disabled={pendingId !== null}
            onClick={() => void handleRestore(cycle)}
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
