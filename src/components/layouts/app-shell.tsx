import { Sidebar } from './sidebar';

interface AppShellProps {
  children: React.ReactNode;
  workspaceKey?: string;
}

export function AppShell({ children, workspaceKey }: AppShellProps) {
  return (
    <div className="flex h-screen overflow-hidden bg-white dark:bg-zinc-900">
      <Sidebar workspaceKey={workspaceKey} />
      <main className="flex flex-1 flex-col overflow-y-auto">{children}</main>
    </div>
  );
}
