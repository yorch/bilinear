import { SettingsNav } from '@/components/layouts/settings-nav';

/**
 * Persistent nav rail for every settings sub-page — previously each of the
 * 8 settings routes was a dead-end reachable only via browser-back. Content
 * pages keep their own scroll container (`overflow-y-auto`), so this layout
 * only supplies the fixed-width rail and a non-scrolling flex row.
 */
export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full min-h-0">
      <SettingsNav />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
