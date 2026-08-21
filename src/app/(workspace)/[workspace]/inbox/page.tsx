import type { Metadata } from 'next';
import { NotificationInbox } from '@/components/notifications/notification-inbox';
import { getServerTranslations } from '@/lib/i18n/server';
import { getAppName } from '@/server/lib/branding';

// This is the one workspace page still a server component, so it can use
// generateMetadata directly (every sibling page is 'use client' for its
// MobX store access and sets document.title client-side instead — see
// useDocumentTitle). Format matches that hook's `${title} · ${appName}`.
export async function generateMetadata(): Promise<Metadata> {
  const [{ t }, appName] = await Promise.all([getServerTranslations(), getAppName()]);
  return { title: `${t('nav.inbox')} · ${appName}` };
}

export default function InboxPage() {
  return (
    <div className="flex-1 overflow-auto">
      <NotificationInbox />
    </div>
  );
}
