import { AppShell } from '@/components/layouts/app-shell';
import { StoreProvider } from '@/providers/store-provider';
import { SyncProvider } from '@/providers/sync-provider';

export default function WorkspaceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <StoreProvider>
      <SyncProvider>
        <AppShell>{children}</AppShell>
      </SyncProvider>
    </StoreProvider>
  );
}
