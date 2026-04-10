'use client';

import { observer } from 'mobx-react-lite';
import { useParams } from 'next/navigation';
import { useCallback } from 'react';
import { CreateProjectModal } from '@/components/projects/create-project-modal';
import { ProjectListView } from '@/components/projects/project-list-view';
import { gql } from '@/lib/graphql';
import { toast } from '@/lib/toast';
import { useStore } from '@/providers/store-provider';

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
          (res.errors[0] as { message: string }).message ??
            'Failed to create project',
        );
      }
      toast.success('Project created');
    },
    [],
  );

  return (
    <>
      <ProjectListView workspaceKey={workspace} />
      <CreateProjectModal
        open={uiStore.createProjectModalOpen}
        onClose={() => uiStore.closeCreateProjectModal()}
        onSubmit={handleCreateProject}
      />
    </>
  );
});
