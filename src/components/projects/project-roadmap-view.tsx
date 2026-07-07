'use client';

import { observer } from 'mobx-react-lite';
import { useRouter } from 'next/navigation';
import { useCallback, useMemo } from 'react';
import { type GanttItem, GanttView } from '@/components/roadmap/gantt-view';
import { useTranslations } from '@/hooks/use-translations';
import { PROJECT_UPDATE_MUTATION } from '@/lib/graphql-queries';
import { toast } from '@/lib/toast';
import { TransactionQueue } from '@/lib/transaction-queue';
import { useStore } from '@/providers/store-provider';

interface ProjectRoadmapViewProps {
  workspaceKey: string;
}

export const ProjectRoadmapView = observer(function ProjectRoadmapView({
  workspaceKey,
}: ProjectRoadmapViewProps) {
  const t = useTranslations();
  const { projectStore } = useStore();
  const router = useRouter();
  const tq = useMemo(() => new TransactionQueue(), []);

  const projects = projectStore.all.filter(
    p => p.statusType !== 'completed' && p.statusType !== 'canceled',
  );

  const items = useMemo<GanttItem[]>(
    () =>
      projects.map(p => ({
        color: p.color,
        endDate: p.targetDate ?? null,
        href: `/${workspaceKey}/project/${p.slugId}`,
        icon: p.icon,
        id: p.id,
        name: p.name,
        startDate: p.startDate ?? null,
        subtitle: p.statusType,
      })),
    [projects, workspaceKey],
  );

  const handleChange = useCallback(
    (id: string, startDate: string | null, endDate: string | null) => {
      const project = projectStore.findById(id);
      if (!project) {
        return;
      }
      // Snapshot only the two fields we mutate. On rollback we re-read the
      // store rather than reusing the closure-captured `project`, so any
      // concurrent WS SyncAction that touched other fields (status, lead,
      // name) between optimistic apply and the failed mutation is
      // preserved instead of clobbered.
      const snapshot = { startDate: project.startDate, targetDate: project.targetDate };
      projectStore.applySyncAction('U', id, {
        ...project,
        startDate,
        targetDate: endDate,
      });
      tq.enqueue(
        PROJECT_UPDATE_MUTATION,
        { id, input: { startDate, targetDate: endDate } },
        {
          onError: () => {
            const current = projectStore.findById(id);
            if (current) {
              projectStore.applySyncAction('U', id, { ...current, ...snapshot });
            }
            toast.error(t('projects.failedToUpdateDates'));
          },
        },
      );
    },
    [projectStore, tq, t],
  );

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold text-foreground">{t('projects.roadmap')}</h2>
        <p className="text-xs text-muted-foreground">{t('projects.roadmapHint')}</p>
      </div>
      <div className="flex-1 overflow-y-auto">
        <GanttView
          emptyMessage={t('projects.roadmapEmptyMessage')}
          items={items}
          onChange={handleChange}
        />
        <div className="px-4 py-2">
          <div className="flex flex-wrap gap-2">
            {projects.map(p => (
              <button
                className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-900"
                key={p.id}
                onClick={() => router.push(`/${workspaceKey}/project/${p.slugId}`)}
                type="button"
              >
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: p.color ?? '#6366f1' }}
                />
                {p.icon ? `${p.icon} ` : ''}
                {p.name}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
});
