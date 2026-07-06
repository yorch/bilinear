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
import Link from 'next/link';
import { useParams, usePathname } from 'next/navigation';
import { useTranslations } from '@/hooks/use-translations';
import { cn } from '@/lib/utils';

const SECTIONS = [
  { href: '', icon: SettingsIcon, labelKey: 'settings.workspace.title' },
  { href: '/integrations', icon: Plug, labelKey: 'settings.workspace.integrations' },
  { href: '/security', icon: Lock, labelKey: 'settings.workspace.security' },
  { href: '/webhooks', icon: Webhook, labelKey: 'settings.workspace.webhooks' },
  { href: '/import', icon: Upload, labelKey: 'settings.workspace.importExport' },
  { href: '/roadmap', icon: MapIcon, labelKey: 'settings.workspace.publicRoadmap' },
  { href: '/automations', icon: Zap, labelKey: 'settings.workspace.automations' },
  { href: '/audit-log', icon: ScrollText, labelKey: 'settings.workspace.auditLog' },
] as const;

/**
 * Persistent left nav for every /settings/* route. The root settings page
 * (`href: ''`) is treated as active only on an exact match; every other
 * section matches on prefix so nested detail routes (e.g. a future
 * settings/webhooks/[id]) still highlight their parent.
 */
export function SettingsNav() {
  const t = useTranslations();
  const pathname = usePathname();
  const { workspace } = useParams<{ workspace: string }>();
  const base = `/${workspace}/settings`;

  return (
    <nav
      aria-label={t('settings.workspace.title')}
      className="w-52 shrink-0 border-r border-border py-4"
    >
      <ul className="flex flex-col gap-0.5 px-2">
        {SECTIONS.map(({ href, icon: Icon, labelKey }) => {
          const target = `${base}${href}`;
          const active = href === '' ? pathname === base : pathname.startsWith(target);
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
  );
}
