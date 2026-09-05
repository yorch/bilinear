'use client';

import { Star } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { Button } from '@/components/ui/button';
import { type FavoriteEntityType, useFavoriteToggle } from '@/hooks/use-favorite-toggle';
import { useTranslations } from '@/hooks/use-translations';
import { cn } from '@/lib/utils';

interface FavoriteToggleProps {
  className?: string;
  entityId: string | null;
  entityType: FavoriteEntityType;
}

/**
 * Star button for a page header: pins the entity to the sidebar Favorites,
 * or removes it. Filled while the entity is pinned.
 */
export const FavoriteToggle = observer(function FavoriteToggle({
  className,
  entityId,
  entityType,
}: FavoriteToggleProps) {
  const t = useTranslations();
  const { isFavorite, pending, toggle } = useFavoriteToggle(entityType, entityId);
  const label = isFavorite ? t('nav.removeFromFavorites') : t('favorites.addToFavorites');

  return (
    <Button
      aria-label={label}
      aria-pressed={isFavorite}
      className={cn('h-8 w-8 text-muted-foreground hover:text-foreground', className)}
      data-testid="favorite-toggle"
      disabled={!entityId || pending}
      onClick={() => void toggle()}
      size="icon"
      title={label}
      type="button"
      variant="ghost"
    >
      <Star
        className={cn('h-4 w-4', isFavorite && 'fill-warning text-warning')}
        data-favorited={isFavorite ? 'true' : 'false'}
      />
    </Button>
  );
});
