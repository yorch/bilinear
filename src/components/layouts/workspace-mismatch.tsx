'use client';

import { Button } from '@/components/ui/button';
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
    <div className="flex flex-1 items-center justify-center p-6">
      <div className="flex max-w-sm flex-col items-center gap-3 text-center">
        <h1 className="text-sm font-semibold text-foreground">
          {t('workspaceSwitcher.mismatchTitle')}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t('workspaceSwitcher.mismatchBody', { name })}
        </p>
        <Button disabled={switching !== null} onClick={() => void handleSwitch()} size="sm">
          {switching ? t('workspaceSwitcher.switching') : t('workspaceSwitcher.switchTo', { name })}
        </Button>
      </div>
    </div>
  );
}
