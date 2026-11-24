'use client';

import { useCallback } from 'react';
import { INITIATIVE_UPDATE_MUTATION } from '@/components/initiatives/initiative-mutations';
import { useTranslations } from '@/hooks/use-translations';
import type { DBInitiative } from '@/lib/db';
import { gqlMutate } from '@/lib/graphql';
import { toast } from '@/lib/toast';
import { useStore } from '@/providers/store-provider';

/** The editable scalars; the store field name equals the GraphQL input name. */
export type InitiativePatch = Partial<
  Pick<DBInitiative, 'description' | 'name' | 'ownerId' | 'parentId' | 'status' | 'targetDate'>
>;

/**
 * One optimistic edit of an initiative: apply to the store at once, send the
 * mutation, and on failure put exactly the touched fields back and say why.
 * Rolling back only the patched keys (from a snapshot taken before the write)
 * means a concurrent sync action for another field is never clobbered.
 */
export function useInitiativeUpdate() {
  const { initiativeStore } = useStore();
  const t = useTranslations();

  return useCallback(
    async (id: string, patch: InitiativePatch): Promise<boolean> => {
      const current = initiativeStore.findById(id);
      if (!current) {
        return false;
      }
      const previous: Record<string, unknown> = {};
      for (const key of Object.keys(patch) as Array<keyof InitiativePatch>) {
        previous[key] = current[key];
      }
      initiativeStore.optimisticUpdate(id, patch);
      try {
        await gqlMutate(INITIATIVE_UPDATE_MUTATION, { id, input: patch });
        return true;
      } catch {
        initiativeStore.optimisticUpdate(id, previous as Partial<DBInitiative>);
        toast.error(t('initiatives.detail.updateFailed'));
        return false;
      }
    },
    [initiativeStore, t],
  );
}
