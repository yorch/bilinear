'use client';

import { Menu } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useTranslations } from '@/hooks/use-translations';
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
  const { syncStore } = useStore();
  const t = useTranslations();
  const appName = useAppName();

  return (
    <div className="flex h-12 flex-shrink-0 items-center gap-2 border-b border-border px-2 md:hidden">
      <button
        aria-label={t('nav.openMenu')}
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
        onClick={onOpenNav}
        title={t('nav.openMenu')}
        type="button"
      >
        <Menu className="h-5 w-5" />
      </button>
      <span className="truncate text-sm font-semibold text-foreground">
        {syncStore.organizationName ?? workspaceKey ?? appName}
      </span>
    </div>
  );
});
