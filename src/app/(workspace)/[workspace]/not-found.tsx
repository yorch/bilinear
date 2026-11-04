import { WorkspaceNotFound } from '@/components/layouts/workspace-not-found';

/** In-shell 404 for any unknown path under a workspace (see `[...missing]`). */
export default function WorkspaceNotFoundPage() {
  return <WorkspaceNotFound />;
}
