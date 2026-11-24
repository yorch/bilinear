'use client';

import { Archive, Target, Undo2 } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useState } from 'react';
import { InlineRetry } from '@/components/shared/inline-retry';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { RowsSkeleton } from '@/components/ui/skeleton';
import { useArchivedLoad } from '@/hooks/use-archived-load';
import { useTranslations } from '@/hooks/use-translations';
import { gqlMutate, gqlQuery } from '@/lib/graphql';
import { toast } from '@/lib/toast';
import { getErrorMessage } from '@/lib/utils';
import { useStore } from '@/providers/store-provider';

/** The few fields the archived list renders — not a full `DBProject`. */
interface ArchivedProjectRow {
  archivedAt: string;
  color: string;
  icon?: string | null;
  id: string;
  name: string;
}

const ARCHIVED_PROJECTS_QUERY = `
  query ArchivedProjects {
    projects(includeArchived: true, first: 200) {
      nodes { id name icon color archivedAt }
    }
  }
`;

const PROJECT_UNARCHIVE_MUTATION = `
  mutation ProjectUnarchive($id: ID!) { projectUnarchive(id: $id) { success lastSyncId } }
`;

/**
 * Archived projects, with a Restore on each.
 *
 * Archived rows are not in the bootstrap, and the GraphQL `Project` type lacks
 * some columns the store's rows carry (`prioritySortOrder`, `trashed`), so
 * fetched rows are held here for display only rather than seeded into
 * `projectStore` half-formed. Projects archived this session are already in the
 * store and are merged in. Restore calls `projectUnarchive`, whose sync action
 * delivers the full row back to every client.
 */
export const ProjectArchivedView = observer(function ProjectArchivedView() {
  const t = useTranslations();
  const { projectStore } = useStore();
  const [fetched, setFetched] = useState<ArchivedProjectRow[]>([]);
  const [restoring, setRestoring] = useState<Set<string>>(new Set());

  const load = useArchivedLoad<ArchivedProjectRow>(
    true,
    async () => {
      const data = await gqlQuery<{ nodes: Array<ArchivedProjectRow | { archivedAt: null }> }>(
        ARCHIVED_PROJECTS_QUERY,
        {},
        'projects',
      );
      return data.nodes.filter((p): p is ArchivedProjectRow => Boolean(p.archivedAt));
    },
    setFetched,
  );

  const inSession: ArchivedProjectRow[] = projectStore.archived.map(p => ({
    archivedAt: p.archivedAt ?? '',
    color: p.color,
    icon: p.icon,
    id: p.id,
    name: p.name,
  }));
  const rows = [...inSession, ...fetched.filter(f => !inSession.some(s => s.id === f.id))]
    // A project restored from here (or elsewhere) is live in the store now.
    .filter(r => !restoring.has(r.id))
    .sort((a, b) => b.archivedAt.localeCompare(a.archivedAt));

  const restore = async (row: ArchivedProjectRow) => {
    setRestoring(prev => new Set(prev).add(row.id));
    projectStore.optimisticUpdate(row.id, { archivedAt: null });
    try {
      await gqlMutate(PROJECT_UNARCHIVE_MUTATION, { id: row.id });
      setFetched(prev => prev.filter(f => f.id !== row.id));
      toast.success(t('projects.projectRestored', { name: row.name }));
    } catch (err) {
      projectStore.optimisticUpdate(row.id, { archivedAt: row.archivedAt });
      toast.error(getErrorMessage(err, t('projects.failedToUnarchive')));
    } finally {
      setRestoring(prev => {
        const next = new Set(prev);
        next.delete(row.id);
        return next;
      });
    }
  };

  if (load.error) {
    return <InlineRetry message={t('projects.loadArchivedFailed')} onRetry={load.retry} />;
  }
  if (load.loading && rows.length === 0) {
    return <RowsSkeleton className="px-4 py-4" count={4} />;
  }
  if (rows.length === 0) {
    return (
      <EmptyState
        description={t('projects.archivedEmptyDescription')}
        icon={<Archive className="h-5 w-5" />}
        testId="empty-state"
        title={t('projects.archivedEmptyTitle')}
      />
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-4 py-4" data-testid="archived-projects">
      <ul className="flex flex-col gap-1">
        {rows.map(row => (
          <li
            className="flex items-center gap-3 rounded-lg border border-border px-3 py-2.5"
            key={row.id}
          >
            <span
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-xs"
              style={{
                backgroundColor: `color-mix(in srgb, ${row.color} 15%, transparent)`,
                color: row.color,
              }}
            >
              {row.icon || <Target aria-hidden="true" className="h-3.5 w-3.5" />}
            </span>
            <span className="min-w-0 flex-1 truncate text-sm text-foreground">{row.name}</span>
            <Button onClick={() => void restore(row)} size="sm" variant="outline">
              <Undo2 className="h-3.5 w-3.5" />
              {t('common.restore')}
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
});
