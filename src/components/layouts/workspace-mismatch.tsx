'use client';

import { Building2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { useOrganizationSwitch } from '@/hooks/use-organization-switch';
import { useTranslations } from '@/hooks/use-translations';
import { toast } from '@/lib/toast';
import { getErrorMessage } from '@/lib/utils';

interface WorkspaceMismatchProps {
  name: string;
  organizationId: string;
}

/**
 * Shown when the URL names a workspace the viewer belongs to but is not
 * currently signed into — see the doc comment on the `[workspace]` guard
 * layout for why this is an explicit prompt rather than an automatic switch.
 *
 * A client component specifically so it can read `window.location.pathname`:
 * server layouts don't receive the request path, and the whole point of
 * offering the switch here is to land on the page that was linked to rather
 * than dumping the user at the workspace root.
 */
export function WorkspaceMismatch({ name, organizationId }: WorkspaceMismatchProps) {
  const t = useTranslations();
  const { switchTo, switching } = useOrganizationSwitch();

  async function handleSwitch() {
    try {
      await switchTo(organizationId, window.location.pathname);
    } catch (err) {
      toast.error(getErrorMessage(err, t('workspaceSwitcher.switchFailed')));
    }
  }

  return (
    <EmptyState
      action={
        <Button disabled={switching !== null} onClick={() => void handleSwitch()} size="sm">
          {switching ? t('workspaceSwitcher.switching') : t('workspaceSwitcher.switchTo', { name })}
        </Button>
      }
      className="flex-1"
      description={t('workspaceSwitcher.mismatchBody', { name })}
      icon={<Building2 className="h-5 w-5" />}
      title={t('workspaceSwitcher.mismatchTitle')}
    />
  );
}
