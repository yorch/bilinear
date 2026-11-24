'use client';

import { useCallback } from 'react';
import { CYCLE_UNARCHIVE_MUTATION } from '@/components/cycles/cycle-mutations';
import { useTranslations } from '@/hooks/use-translations';
import type { DBCycle } from '@/lib/db';
import { gqlMutate } from '@/lib/graphql';
import { CYCLE_ARCHIVE_MUTATION } from '@/lib/graphql-queries';
import { toast } from '@/lib/toast';
import { getErrorMessage } from '@/lib/utils';
import { useStore } from '@/providers/store-provider';

/**
 * Archive / restore for the cycles list. Both are optimistic: the row moves
 * between the Active and Archived views at once (the store filters on
 * `archivedAt`) and a refusal puts it back with a toast. Archiving offers an
 * undo that restores.
 */
export function useCycleArchive() {
  const { cycleStore } = useStore();
  const t = useTranslations();

  const restore = useCallback(
    async (cycle: DBCycle) => {
      const prev = cycle.archivedAt ?? new Date().toISOString();
      cycleStore.optimisticUpdate(cycle.id, { archivedAt: null });
      try {
        await gqlMutate(CYCLE_UNARCHIVE_MUTATION, { id: cycle.id });
        return true;
      } catch (err) {
        cycleStore.optimisticUpdate(cycle.id, { archivedAt: prev });
        toast.error(getErrorMessage(err, t('cycles.list.restoreFailed')));
        return false;
      }
    },
    [cycleStore, t],
  );

  const archive = useCallback(
    async (cycle: DBCycle) => {
      cycleStore.optimisticUpdate(cycle.id, { archivedAt: new Date().toISOString() });
      try {
        await gqlMutate(CYCLE_ARCHIVE_MUTATION, { id: cycle.id });
        toast.undo(t('cycles.list.archivedToast'), t('common.undo'), () => void restore(cycle));
      } catch (err) {
        cycleStore.optimisticUpdate(cycle.id, { archivedAt: null });
        toast.error(getErrorMessage(err, t('cycles.list.archiveFailed')));
      }
    },
    [cycleStore, restore, t],
  );

  return { archive, restore };
}
