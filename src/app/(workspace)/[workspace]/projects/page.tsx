'use client';

import { LayoutList, Map as MapIcon, Plus } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useParams } from 'next/navigation';
import { useCallback, useState } from 'react';
import { CreateProjectModal } from '@/components/projects/create-project-modal';
import { ProjectListView } from '@/components/projects/project-list-view';
import { ProjectRoadmapView } from '@/components/projects/project-roadmap-view';
import { gql } from '@/lib/graphql';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';
import { useStore } from '@/providers/store-provider';

type ProjectsLayout = 'list' | 'roadmap';

const STORAGE_KEY = 'bilinear:projects:layout';

const PROJECT_CREATE_MUTATION = `
  mutation ProjectCreate($input: ProjectCreateInput!) {
    projectCreate(input: $input) {
      success
      lastSyncId
      project {
        id
        name
        slugId
      }
    }
  }
`;

export default observer(function ProjectsPage() {
  const { workspace } = useParams<{ workspace: string }>();
  const { uiStore } = useStore();
  const [layout, setLayout] = useState<ProjectsLayout>(() => {
    if (typeof window === 'undefined') {
      return 'list';
    }
    const saved = window.localStorage.getItem(STORAGE_KEY);
    return saved === 'roadmap' ? 'roadmap' : 'list';
  });

  const setLayoutPersisted = useCallback((next: ProjectsLayout) => {
    setLayout(next);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, next);
    }
  }, []);

  const handleCreateProject = useCallback(
    async (input: {
      name: string;
      description?: string;
      statusType: string;
      teamIds: string[];
      leadId?: string;
      startDate?: string;
      targetDate?: string;
    }) => {
      const res = await gql(PROJECT_CREATE_MUTATION, { input });
      if (res.errors?.length) {
        throw new Error(
          (res.errors[0] as { message: string }).message ?? 'Failed to create project',
        );
      }
      toast.success('Project created');
    },
    [],
  );

  return (
    <>
      <div className="flex h-12 items-center gap-2 border-b border-zinc-200 px-4 dark:border-zinc-800">
        <h1 className="flex-1 text-sm font-semibold text-zinc-900 dark:text-zinc-100">Projects</h1>
        <div className="flex rounded-md border border-zinc-200 p-0.5 dark:border-zinc-800">
          <button
            aria-label="List view"
            className={cn(
              'flex items-center gap-1 rounded px-2 py-1 text-xs transition-colors',
              layout === 'list'
                ? 'bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100'
                : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100',
            )}
            onClick={() => setLayoutPersisted('list')}
            type="button"
          >
            <LayoutList className="h-3.5 w-3.5" />
            List
          </button>
          <button
            aria-label="Roadmap view"
            className={cn(
              'flex items-center gap-1 rounded px-2 py-1 text-xs transition-colors',
              layout === 'roadmap'
                ? 'bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100'
                : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100',
            )}
            onClick={() => setLayoutPersisted('roadmap')}
            type="button"
          >
            <MapIcon className="h-3.5 w-3.5" />
            Roadmap
          </button>
        </div>
        <button
          className="flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-indigo-700"
          onClick={() => uiStore.openCreateProjectModal()}
          type="button"
        >
          <Plus className="h-3.5 w-3.5" />
          New Project
        </button>
      </div>
      {layout === 'list' ? (
        <ProjectListView workspaceKey={workspace} />
      ) : (
        <ProjectRoadmapView workspaceKey={workspace} />
      )}
      <CreateProjectModal
        onClose={() => uiStore.closeCreateProjectModal()}
        onSubmit={handleCreateProject}
        open={uiStore.createProjectModalOpen}
      />
    </>
  );
});
