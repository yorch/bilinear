'use client';

import { observer } from 'mobx-react-lite';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useTranslations } from '@/hooks/use-translations';
import { stopImpersonation } from '@/lib/admin-api';
import { gql } from '@/lib/graphql';
import { toast } from '@/lib/toast';
import { useStore } from '@/providers/store-provider';

interface ImpersonationState {
  active: boolean;
  adminEmail: string | null;
  adminName: string | null;
}

const IMPERSONATION_STATE_QUERY = `
  query ImpersonationState {
    impersonationState { active adminEmail adminName }
  }
`;

/**
 * Sticky banner shown across the workspace whenever the current session is a
 * platform admin impersonating another user. Provides the one-click exit that
 * restores the admin's own session. Renders nothing for normal sessions.
 */
export const ImpersonationBanner = observer(function ImpersonationBanner() {
  const t = useTranslations();
  const { syncStore, userStore } = useStore();
  const [state, setState] = useState<ImpersonationState | null>(null);
  const [stopping, setStopping] = useState(false);

  useEffect(() => {
    let cancelled = false;
    gql(IMPERSONATION_STATE_QUERY)
      .then(res => {
        if (cancelled || res.errors?.length) {
          return;
        }
        const s = (res.data as { impersonationState?: ImpersonationState } | undefined)
          ?.impersonationState;
        if (s?.active) {
          setState(s);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  if (!state?.active) {
    return null;
  }

  async function handleStop() {
    setStopping(true);
    try {
      await stopImpersonation();
      window.location.href = '/admin/users';
    } catch (e) {
      toast.error((e as Error).message);
      setStopping(false);
    }
  }

  // Name who is being impersonated (the session's own user) and where, not
  // the operator: the operator is the one clicking, the viewed identity is what
  // they need to be reminded of.
  const viewed = userStore.currentUser?.displayName;
  const org = syncStore.organizationName;

  return (
    <div
      className="sticky top-0 z-50 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-warning px-4 py-2 text-center font-medium text-sm text-warning-foreground"
      data-testid="impersonation-banner"
      role="status"
    >
      <span>
        {viewed && org
          ? t('admin.impersonation.viewingAs', {
              admin: state.adminName ?? state.adminEmail ?? '',
              org,
              user: viewed,
            })
          : t('admin.impersonation.banner')}
      </span>
      <Button
        className="bg-warning-foreground/20 text-warning-foreground hover:bg-warning-foreground/30"
        data-testid="stop-impersonating"
        disabled={stopping}
        onClick={handleStop}
        size="xs"
        type="button"
        variant="ghost"
      >
        {stopping ? t('admin.impersonation.stopping') : t('admin.impersonation.stop')}
      </Button>
    </div>
  );
});
