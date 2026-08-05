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
import { SegmentedControl } from '@/components/ui/segmented-control';
import { useDocumentTitle } from '@/hooks/use-document-title';
import { useTranslations } from '@/hooks/use-translations';
import { gql } from '@/lib/graphql';
import { toast } from '@/lib/toast';
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
            <SegmentedControl
              onChange={setLayoutPersisted}
              options={[
                {
                  ariaLabel: t('projects.listView'),
                  label: (
                    <>
                      <LayoutList className="h-3.5 w-3.5" />
                      {t('projects.list')}
                    </>
                  ),
                  value: 'list',
                },
                {
                  ariaLabel: t('projects.roadmapView'),
                  label: (
                    <>
                      <MapIcon className="h-3.5 w-3.5" />
                      {t('projects.roadmap')}
                    </>
                  ),
                  value: 'roadmap',
                },
              ]}
              size="md"
              value={layout}
            />
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
