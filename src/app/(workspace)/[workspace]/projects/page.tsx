'use client';

import { Archive, LayoutList, Map as MapIcon, Plus } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { CreateProjectModal } from '@/components/projects/create-project-modal';
import { ProjectArchivedView } from '@/components/projects/project-archived-view';
import { ProjectListView } from '@/components/projects/project-list-view';
import { ProjectRoadmapView } from '@/components/projects/project-roadmap-view';
import { TabSwitcher, tabPanelProps } from '@/components/shared/tab-switcher';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { useDocumentTitle } from '@/hooks/use-document-title';
import { useTranslations } from '@/hooks/use-translations';
import { gql } from '@/lib/graphql';
import { useStore } from '@/providers/store-provider';

type ProjectsLayout = 'archived' | 'list' | 'roadmap';

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
  const { projectStore, uiStore } = useStore();
  // Starts as 'list' on both server and first client render; the stored layout
  // is applied in an effect so hydration never sees a different tree.
  const [layout, setLayout] = useState<ProjectsLayout>('list');
  useEffect(() => {
    try {
      if (window.localStorage.getItem(STORAGE_KEY) === 'roadmap') {
        setLayout('roadmap');
      }
    } catch {
      // Storage blocked: stay on the list.
    }
  }, []);

  const setLayoutPersisted = useCallback((next: ProjectsLayout) => {
    setLayout(next);
    // Archived is a place to visit, not a layout to wake up in.
    if (typeof window !== 'undefined' && next !== 'archived') {
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
      // No toast here: CreateProjectModal toasts once after this resolves.
    },
    [t],
  );

  return (
    <>
      <PageHeader
        actions={
          <>
            <TabSwitcher
              ariaLabel={t('projects.viewLabel')}
              idPrefix="projects-view"
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
                {
                  ariaLabel: t('projects.archivedView'),
                  label: (
                    <>
                      <Archive className="h-3.5 w-3.5" />
                      {t('projects.archivedTab')}
                    </>
                  ),
                  value: 'archived',
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
        count={projectStore.all.length}
        title={t('projects.title')}
      />
      <div {...tabPanelProps('projects-view', layout)} className="flex min-h-0 flex-1 flex-col">
        {layout === 'list' ? (
          <ProjectListView workspaceKey={workspace} />
        ) : layout === 'archived' ? (
          <ProjectArchivedView />
        ) : (
          <ProjectRoadmapView workspaceKey={workspace} />
        )}
      </div>
      <CreateProjectModal
        onClose={() => uiStore.closeCreateProjectModal()}
        onSubmit={handleCreateProject}
        open={uiStore.createProjectModalOpen}
      />
    </>
  );
});
