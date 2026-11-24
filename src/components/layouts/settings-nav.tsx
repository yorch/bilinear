'use client';

import {
  Lock,
  Map as MapIcon,
  Plug,
  ScrollText,
  Settings as SettingsIcon,
  Upload,
  Webhook,
  Zap,
} from 'lucide-react';
import { observer } from 'mobx-react-lite';
import Link from 'next/link';
import { useParams, usePathname, useRouter } from 'next/navigation';
import { SimpleSelect } from '@/components/ui/select';
import { useTranslations } from '@/hooks/use-translations';
import { cn } from '@/lib/utils';
import { useStore } from '@/providers/store-provider';

interface SettingsSection {
  /** Whole section is owner/admin-only on the server; hidden from everyone else. */
  adminOnly?: boolean;
  href: string;
  icon: typeof SettingsIcon;
  labelKey: string;
}

const SECTIONS: readonly SettingsSection[] = [
  { href: '', icon: SettingsIcon, labelKey: 'settings.workspace.title' },
  {
    adminOnly: true,
    href: '/integrations',
    icon: Plug,
    labelKey: 'settings.workspace.integrations',
  },
  { adminOnly: true, href: '/security', icon: Lock, labelKey: 'settings.workspace.security' },
  { adminOnly: true, href: '/webhooks', icon: Webhook, labelKey: 'settings.workspace.webhooks' },
  { adminOnly: true, href: '/import', icon: Upload, labelKey: 'settings.workspace.importExport' },
  { href: '/roadmap', icon: MapIcon, labelKey: 'settings.workspace.publicRoadmap' },
  { adminOnly: true, href: '/automations', icon: Zap, labelKey: 'settings.workspace.automations' },
  {
    adminOnly: true,
    href: '/audit-log',
    icon: ScrollText,
    labelKey: 'settings.workspace.auditLog',
  },
];

/**
 * The sections a viewer should be offered. An unknown role (the stores have not
 * hydrated yet) is treated as non-admin, so a member never sees admin links
 * flash in before the role resolves.
 */
export function sectionsForRole(role: string | null | undefined): readonly SettingsSection[] {
  const isAdmin = role === 'owner' || role === 'admin';
  return SECTIONS.filter(s => isAdmin || !s.adminOnly);
}

/**
 * Persistent left nav for every /settings/* route. The root settings page
 * (`href: ''`) is treated as active only on an exact match; every other
 * section matches on prefix so nested detail routes (e.g. a future
 * settings/webhooks/[id]) still highlight their parent.
 */
export const SettingsNav = observer(function SettingsNav() {
  const t = useTranslations();
  const { organizationMemberStore, userStore } = useStore();
  const viewerRole = userStore.currentUser
    ? organizationMemberStore.rolesByUserId[userStore.currentUser.id]
    : undefined;
  const sections = sectionsForRole(viewerRole);
  const pathname = usePathname();
  const { workspace } = useParams<{ workspace: string }>();
  const router = useRouter();
  const base = `/${workspace}/settings`;
  const isActive = (href: string) =>
    href === '' ? pathname === base : pathname.startsWith(`${base}${href}`);
  const activeHref = sections.find(s => isActive(s.href))?.href ?? '';

  return (
    <>
      {/* Below md the 208px rail would leave ~110px for content, so it becomes
          a one-row section picker above the page. */}
      <nav
        aria-label={t('settings.workspace.title')}
        className="shrink-0 border-b border-border px-4 py-2 md:hidden"
      >
        <SimpleSelect
          ariaLabel={t('settings.workspace.title')}
          onChange={href => router.push(`${base}${href}`)}
          options={sections.map(s => ({ label: t(s.labelKey), value: s.href }))}
          value={activeHref}
        />
      </nav>
      <nav
        aria-label={t('settings.workspace.title')}
        className="hidden w-52 shrink-0 border-r border-border py-4 md:block"
      >
        <ul className="flex flex-col gap-0.5 px-2">
          {sections.map(({ href, icon: Icon, labelKey }) => {
            const target = `${base}${href}`;
            const active = isActive(href);
            return (
              <li key={href}>
                <Link
                  className={cn(
                    'flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm transition-colors',
                    active
                      ? 'bg-accent font-medium text-foreground'
                      : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
                  )}
                  href={target}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="truncate">{t(labelKey)}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
});
