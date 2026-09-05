'use client';

import { observer } from 'mobx-react-lite';
import { useParams } from 'next/navigation';
import { FavoriteToggle } from '@/components/layouts/favorite-toggle';
import { ProjectDetailView } from '@/components/projects/project-detail-view';
import { useStore } from '@/providers/store-provider';

const ProjectPage = observer(function ProjectPage() {
  const { workspace, slug } = useParams<{ workspace: string; slug: string }>();
  const { projectStore } = useStore();
  const project = projectStore.findBySlugId(slug);

  return (
    <ProjectDetailView
      actions={project ? <FavoriteToggle entityId={project.id} entityType="Project" /> : null}
      projectSlugId={slug}
      workspaceKey={workspace}
    />
  );
});

export default ProjectPage;
