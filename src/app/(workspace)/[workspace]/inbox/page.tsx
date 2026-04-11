import { NotificationInbox } from '@/components/notifications/notification-inbox';

export default function InboxPage() {
  return (
    <div className="flex-1 overflow-auto">
      <NotificationInbox />
    </div>
  );
}
