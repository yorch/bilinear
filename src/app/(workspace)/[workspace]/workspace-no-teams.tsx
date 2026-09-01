'use client';

import { Users } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { useDocumentTitle } from '@/hooks/use-document-title';
import { useTranslations } from '@/hooks/use-translations';
import { useStore } from '@/providers/store-provider';

export const WorkspaceNoTeams = observer(function WorkspaceNoTeams() {
  const t = useTranslations();
  const { uiStore } = useStore();
  // The workspace root is a server component that redirects to the first team,
  // so this empty state is the only thing it ever renders — and the only place
  // that route can set a title from.
  useDocumentTitle(t('nav.createTeam'));
  return (
    <EmptyState
      action={
        <Button onClick={() => uiStore.openCreateTeamModal()} size="sm" type="button">
          {t('teams.createTeam')}
        </Button>
      }
      description={t('layout.workspacePage.noTeams')}
      icon={<Users className="h-5 w-5" />}
      testId="empty-state"
      title={t('layout.workspacePage.noTeamsTitle')}
    />
  );
});
