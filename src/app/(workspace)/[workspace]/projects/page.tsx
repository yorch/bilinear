'use client';

import { LayoutList, Map as MapIcon, Plus } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useParams } from 'next/navigation';
import { useCallback, useState } from 'react';
import { CreateProjectModal } from '@/components/projects/create-project-modal';
import { ProjectListView } from '@/components/projects/project-list-view';
import { ProjectRoadmapView } from '@/components/projects/project-roadmap-view';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { useDocumentTitle } from '@/hooks/use-document-title';
import { useTranslations } from '@/hooks/use-translations';
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
  const t = useTranslations();
  useDocumentTitle(t('nav.projects'));
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
          (res.errors[0] as { message: string }).message ?? t('projects.failedToCreate'),
        );
      }
      toast.success(t('projects.projectCreated'));
    },
    [t],
  );

  return (
    <>
      <PageHeader
        actions={
          <>
            <div className="flex rounded-md border border-border p-0.5">
              <button
                aria-label={t('projects.listView')}
                className={cn(
                  'flex items-center gap-1 rounded px-2 py-1 text-xs transition-colors',
                  layout === 'list'
                    ? 'bg-muted text-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )}
                onClick={() => setLayoutPersisted('list')}
                type="button"
              >
                <LayoutList className="h-3.5 w-3.5" />
                {t('projects.list')}
              </button>
              <button
                aria-label={t('projects.roadmapView')}
                className={cn(
                  'flex items-center gap-1 rounded px-2 py-1 text-xs transition-colors',
                  layout === 'roadmap'
                    ? 'bg-muted text-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )}
                onClick={() => setLayoutPersisted('roadmap')}
                type="button"
              >
                <MapIcon className="h-3.5 w-3.5" />
                {t('projects.roadmap')}
              </button>
            </div>
            <Button onClick={() => uiStore.openCreateProjectModal()} size="sm" type="button">
              <Plus className="h-3.5 w-3.5" />
              {t('projects.newProject')}
            </Button>
          </>
        }
        title={t('projects.title')}
      />
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
