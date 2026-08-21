import { NotificationInbox } from '@/components/notifications/notification-inbox';
import { titleMetadata } from '@/lib/page-metadata';

// This is the one workspace page still a server component, so it can use
// generateMetadata directly (every sibling page is 'use client' for its
// MobX store access and sets document.title client-side instead — see
// useDocumentTitle). Format matches that hook's `${title} · ${appName}`.
export const generateMetadata = () => titleMetadata('nav.inbox', '·');

export default function InboxPage() {
  return (
    <div className="flex-1 overflow-auto">
      <NotificationInbox />
    </div>
  );
}
