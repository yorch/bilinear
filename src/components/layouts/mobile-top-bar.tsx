'use client';

import { Menu, Search } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { ConnectionStatus } from '@/components/layouts/connection-status';
import { LoadingRegion, Skeleton } from '@/components/ui/skeleton';
import { useTranslations } from '@/hooks/use-translations';
import { cn, TOUCH_TARGET_SQUARE } from '@/lib/utils';
import { useAppName } from '@/providers/branding-provider';
import { useStore } from '@/providers/store-provider';

interface MobileTopBarProps {
  onOpenNav: () => void;
  workspaceKey?: string;
}

/**
 * Compact header shown only below `md`, once the sidebar becomes an
 * off-canvas drawer instead of a persistent rail. The hamburger button is
 * the only way to reach navigation on a phone-width viewport.
 */
export const MobileTopBar = observer(function MobileTopBar({
  onOpenNav,
  workspaceKey,
}: MobileTopBarProps) {
  const { notificationStore, syncStore, uiStore } = useStore();
  const unreadCount = notificationStore.unreadCount;
  const bootstrapping = syncStore.status === 'idle' || syncStore.status === 'bootstrapping';
  const t = useTranslations();
  const appName = useAppName();

  return (
    <div className="flex h-12 flex-shrink-0 items-center gap-2 border-b border-border px-2 md:hidden">
      <button
        aria-label={t('nav.openMenu')}
        className={cn(
          'flex shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground',
          TOUCH_TARGET_SQUARE,
        )}
        onClick={onOpenNav}
        title={t('nav.openMenu')}
        type="button"
      >
        <span className="relative">
          <Menu className="h-5 w-5" />
          {unreadCount > 0 && (
            <span
              aria-hidden="true"
              className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-brand"
            />
          )}
        </span>
        {unreadCount > 0 && (
          <span className="sr-only">{t('nav.unreadCount', { count: unreadCount })}</span>
        )}
      </button>
      <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
        {syncStore.organizationName ??
          (bootstrapping ? (
            <LoadingRegion>
              <Skeleton className="h-4 w-24" />
            </LoadingRegion>
          ) : (
            (workspaceKey ?? appName)
          ))}
      </span>
      <ConnectionStatus compact />
      <button
        aria-label={t('common.search')}
        className={cn(
          'flex shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground',
          TOUCH_TARGET_SQUARE,
        )}
        onClick={() => uiStore.openCommandPalette()}
        title={t('common.search')}
        type="button"
      >
        <Search className="h-5 w-5" />
      </button>
    </div>
  );
});
