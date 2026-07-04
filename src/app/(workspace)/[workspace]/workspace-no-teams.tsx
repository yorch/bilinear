'use client';

import { useTranslations } from '@/hooks/use-translations';

export function WorkspaceNoTeams() {
  const t = useTranslations();
  return (
    <div className="flex flex-1 items-center justify-center text-sm text-zinc-400">
      {t('layout.workspacePage.noTeams')}
    </div>
  );
}
