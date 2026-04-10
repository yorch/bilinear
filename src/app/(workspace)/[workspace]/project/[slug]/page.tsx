'use client';

import { useParams } from 'next/navigation';
import { ProjectDetailView } from '@/components/projects/project-detail-view';

export default function ProjectPage() {
  const { workspace, slug } = useParams<{ workspace: string; slug: string }>();

  return <ProjectDetailView projectSlugId={slug} workspaceKey={workspace} />;
}
