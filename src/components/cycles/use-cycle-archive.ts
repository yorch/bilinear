'use client';

import { useCallback, useRef } from 'react';
import { CYCLE_UNARCHIVE_MUTATION } from '@/components/cycles/cycle-mutations';
import { useTranslations } from '@/hooks/use-translations';
import type { DBCycle } from '@/lib/db';
import { gqlMutate, isGqlErrorCode } from '@/lib/graphql';
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
  // Cycle ids with a restore in flight: a second click (or the undo toast
  // racing the Restore button) must not fire a second mutation.
  const restoring = useRef(new Set<string>());

  const restore = useCallback(
    async (cycle: DBCycle) => {
      if (restoring.current.has(cycle.id)) {
        return false;
      }
      restoring.current.add(cycle.id);
      const prev = cycle.archivedAt ?? new Date().toISOString();
      cycleStore.optimisticUpdate(cycle.id, { archivedAt: null });
      try {
        await gqlMutate(CYCLE_UNARCHIVE_MUTATION, { id: cycle.id });
        return true;
      } catch (err) {
        cycleStore.optimisticUpdate(cycle.id, { archivedAt: prev });
        // The server refuses a restore whose dates another active cycle now
        // covers (its only BAD_USER_INPUT); show localized copy, not its text.
        toast.error(
          isGqlErrorCode(err, 'BAD_USER_INPUT')
            ? t('cycles.list.restoreOverlap')
            : getErrorMessage(err, t('cycles.list.restoreFailed')),
        );
        return false;
      } finally {
        restoring.current.delete(cycle.id);
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
