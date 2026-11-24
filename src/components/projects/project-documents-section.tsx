'use client';

import { observer } from 'mobx-react-lite';
import { DocumentList, useCreateDocument } from '@/components/documents/document-list';
import { SectionAddButton, SectionHeader } from '@/components/shared/section-header';
import { useTranslations } from '@/hooks/use-translations';
import { useStore } from '@/providers/store-provider';

/**
 * Documents attached to a project. The schema has always allowed a document to
 * carry a `projectId`, but nothing in the UI could create or list one — the
 * only trace was the workspace docs list. New documents made here are created
 * with this project's id, and `DocumentList` (with its sub-page nesting and
 * row actions) is reused rather than re-rolled.
 */
export const ProjectDocumentsSection = observer(function ProjectDocumentsSection({
  projectId,
}: {
  projectId: string;
}) {
  const t = useTranslations();
  const { documentStore } = useStore();
  const { create, creating } = useCreateDocument({ projectId });
  const count = documentStore.getByProjectId(projectId).length;

  return (
    <div className="mt-6" data-testid="project-documents">
      <SectionHeader
        action={
          <SectionAddButton
            disabled={creating}
            label={t('documents.newProjectDocument')}
            onClick={() => void create()}
          />
        }
        as="h2"
        count={count}
        title={t('documents.projectSection')}
      />
      {/* DocumentList pads itself for the full-page case; -mx cancels that so the
          rows line up with the neighbouring sections. */}
      <div className="-mx-4 -my-2">
        <DocumentList hideArchivedToggle projectId={projectId} />
      </div>
    </div>
  );
});
