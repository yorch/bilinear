import type { Metadata } from 'next';
import { NotificationInbox } from '@/components/notifications/notification-inbox';
import { APP_NAME } from '@/lib/app-config';
import { getServerTranslations } from '@/lib/i18n/server';

// This is the one workspace page still a server component, so it can use
// generateMetadata directly (every sibling page is 'use client' for its
// MobX store access and sets document.title client-side instead — see
// useDocumentTitle). Format matches that hook's `${title} · ${APP_NAME}`.
export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslations();
  return { title: `${t('nav.inbox')} · ${APP_NAME}` };
}

export default function InboxPage() {
  return (
    <div className="flex-1 overflow-auto">
      <NotificationInbox />
    </div>
  );
}
