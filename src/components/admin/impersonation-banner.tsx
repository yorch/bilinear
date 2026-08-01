'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from '@/hooks/use-translations';
import { stopImpersonation } from '@/lib/admin-api';
import { gql } from '@/lib/graphql';
import { toast } from '@/lib/toast';

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
export function ImpersonationBanner() {
  const t = useTranslations();
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

  return (
    <div
      className="flex items-center justify-center gap-3 bg-warning px-4 py-1.5 text-center text-xs font-medium text-warning-subtle-foreground"
      data-testid="impersonation-banner"
    >
      <span>
        {state.adminName
          ? t('admin.impersonation.bannerAs', { name: state.adminName })
          : t('admin.impersonation.banner')}
      </span>
      <button
        className="rounded bg-warning-subtle/20 px-2 py-0.5 font-semibold hover:bg-warning-subtle/30 disabled:opacity-50"
        data-testid="stop-impersonating"
        disabled={stopping}
        onClick={handleStop}
        type="button"
      >
        {stopping ? t('admin.impersonation.stopping') : t('admin.impersonation.stop')}
      </button>
    </div>
  );
}
