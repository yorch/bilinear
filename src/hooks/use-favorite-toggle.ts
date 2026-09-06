'use client';

import { useCallback, useState } from 'react';
import { useTranslations } from '@/hooks/use-translations';
import type { DBFavorite } from '@/lib/db';
import { gqlMutate } from '@/lib/graphql';
import { FAVORITE_CREATE_MUTATION, FAVORITE_DELETE_MUTATION } from '@/lib/graphql-queries';
import { toast } from '@/lib/toast';
import { getErrorMessage } from '@/lib/utils';
import { useStore } from '@/providers/store-provider';

/** Mirrors the `FavoriteEntityType` GraphQL enum. */
export type FavoriteEntityType =
  | 'Issue'
  | 'Project'
  | 'Initiative'
  | 'CustomView'
  | 'Cycle'
  | 'Document'
  | 'Team';

/**
 * Pin / unpin an entity in the sidebar Favorites. The store is patched from
 * the mutation payload so the sidebar (which re-fetches whenever the
 * `favoriteStore` changes) picks the new entry up before the SyncAction lands.
 * Callers must be `observer()`s — `isFavorite` is a live store read.
 */
export function useFavoriteToggle(entityType: FavoriteEntityType, entityId: string | null) {
  const { favoriteStore } = useStore();
  const t = useTranslations();
  const [pending, setPending] = useState(false);

  const favorite = entityId ? favoriteStore.getByEntityId(entityId) : null;
  const isFavorite = favorite !== null;

  const toggle = useCallback(async () => {
    if (!entityId || pending) {
      return;
    }
    setPending(true);
    try {
      const existing = favoriteStore.getByEntityId(entityId);
      if (existing) {
        await gqlMutate(FAVORITE_DELETE_MUTATION, { id: existing.id });
        favoriteStore.applySyncAction('D', existing.id, null);
        toast.success(t('favorites.removed'));
      } else {
        const data = await gqlMutate(FAVORITE_CREATE_MUTATION, {
          input: { entityId, entityType },
        });
        const created = (data as { favoriteCreate?: { favorite?: DBFavorite | null } })
          .favoriteCreate?.favorite;
        if (created) {
          favoriteStore.applySyncAction('I', created.id, created);
        }
        toast.success(t('favorites.added'));
      }
    } catch (err) {
      toast.error(
        getErrorMessage(
          err,
          favorite ? t('nav.failedToRemoveFavorite') : t('favorites.failedToAdd'),
        ),
      );
    } finally {
      setPending(false);
    }
  }, [entityId, entityType, favorite, favoriteStore, pending, t]);

  return { isFavorite, pending, toggle };
}
