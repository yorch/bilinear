'use client';

import { FileQuestion } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { useTranslations } from '@/hooks/use-translations';

/**
 * "Nothing here" rendered inside the app shell, so the sidebar, the command
 * palette and the user's place all survive. Used for an unknown URL under a
 * workspace and for an issue that does not exist; both used to either drop the
 * user out of the shell or show a bare string with no way back.
 */
export function WorkspaceNotFound({ detail, title }: { detail?: string; title?: string }) {
  const t = useTranslations();
  const { workspace } = useParams<{ workspace?: string }>();
  const home = workspace ? `/${workspace}/my-issues` : '/';

  return (
    <div className="flex flex-1 items-center justify-center">
      <h1 className="sr-only">{title ?? t('errors.workspaceNotFoundTitle')}</h1>
      <EmptyState
        action={
          <Button asChild size="sm">
            <Link href={home}>{t('commandPalette.actions.goToMyIssues')}</Link>
          </Button>
        }
        description={detail ?? t('errors.workspaceNotFoundDetail')}
        icon={<FileQuestion className="h-5 w-5" />}
        testId="workspace-not-found"
        title={title ?? t('errors.workspaceNotFoundTitle')}
      />
    </div>
  );
}
