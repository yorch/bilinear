import { ImpersonationBanner } from '@/components/admin/impersonation-banner';
import { AppShell } from '@/components/layouts/app-shell';
import { WorkspaceClient } from '@/components/layouts/workspace-client';
import { StoreProvider } from '@/providers/store-provider';
import { SyncProvider } from '@/providers/sync-provider';

export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  return (
    <StoreProvider>
      <SyncProvider>
        <WorkspaceClient>
          <ImpersonationBanner />
          <AppShell>{children}</AppShell>
        </WorkspaceClient>
      </SyncProvider>
    </StoreProvider>
  );
}
