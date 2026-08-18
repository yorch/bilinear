'use client';

import { useDocumentTitle } from '@/hooks/use-document-title';
import { useTranslations } from '@/hooks/use-translations';

export function WorkspaceNoTeams() {
  const t = useTranslations();
  // The workspace root is a server component that redirects to the first team,
  // so this empty state is the only thing it ever renders — and the only place
  // that route can set a title from.
  useDocumentTitle(t('nav.createTeam'));
  return (
    <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
      {t('layout.workspacePage.noTeams')}
    </div>
  );
}
