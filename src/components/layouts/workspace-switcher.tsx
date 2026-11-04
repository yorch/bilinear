'use client';

import { Check, ChevronsUpDown, Plus } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { SelectPopover } from '@/components/ui/select-popover';
import { LoadingRegion, Skeleton } from '@/components/ui/skeleton';
import {
  fetchViewerOrganizations,
  pendingWriteCount,
  useOrganizationSwitch,
  type ViewerOrganization,
} from '@/hooks/use-organization-switch';
import { useTranslations } from '@/hooks/use-translations';
import { createClientLogger } from '@/lib/logger';
import { toast } from '@/lib/toast';
import { cn, getErrorMessage } from '@/lib/utils';

const log = createClientLogger('WorkspaceSwitcher');

interface WorkspaceSwitcherProps {
  /**
   * Renders a one-letter tile when the rail is collapsed. Taken as a prop
   * rather than letting the sidebar conditionally mount the component, so
   * collapsing and re-expanding doesn't unmount it and re-run the workspace
   * fetch.
   */
  collapsed: boolean;
  /**
   * Label to show before the org list resolves. `null` means "not known yet"
   * (the sync bootstrap is still running) and renders a skeleton, not the raw
   * URL key.
   */
  fallbackLabel: string | null;
}

/**
 * The workspace name in the sidebar header. It is always a menu once the
 * workspace list has loaded: with one org it shows that org plus "Create
 * workspace" (otherwise a single-workspace user had no way to reach it), with
 * several it is the switcher.
 */
export function WorkspaceSwitcher({ collapsed, fallbackLabel }: WorkspaceSwitcherProps) {
  const t = useTranslations();
  const [orgs, setOrgs] = useState<ViewerOrganization[] | null>(null);
  const [confirmingSwitchTo, setConfirmingSwitchTo] = useState<ViewerOrganization | null>(null);
  const { switchTo, switching } = useOrganizationSwitch();

  // Fetched once per document load — the sidebar lives in the app shell, so
  // neither client-side navigation nor collapsing the rail remounts this. A
  // failure is non-fatal: the header falls back to the plain label rather
  // than blocking the sidebar.
  useEffect(() => {
    let cancelled = false;
    fetchViewerOrganizations()
      .then(rows => {
        if (!cancelled) {
          setOrgs(rows);
        }
      })
      .catch(err => log.error('Failed to load workspaces', err));
    return () => {
      cancelled = true;
    };
  }, []);

  const current = orgs?.find(o => o.current);
  const label = current?.name ?? fallbackLabel;

  async function performSwitch(org: ViewerOrganization) {
    try {
      // Preserve the page the user is on: the destination workspace has the
      // same route shape, so `/old-key/team/ENG` becomes `/new-key/team/ENG`.
      // A team key that doesn't exist over there just lands on that org's
      // own not-found handling, which is the honest outcome.
      await switchTo(org.id, window.location.pathname);
    } catch (err) {
      toast.error(getErrorMessage(err, t('workspaceSwitcher.switchFailed')));
    }
  }

  function requestSwitch(org: ViewerOrganization) {
    // Queued offline mutations are scoped to the session that enqueued them
    // and are dropped — not replayed — once a different session hydrates the
    // queue (see TransactionQueue.hydrate). Switching with writes still in
    // flight therefore discards them, so ask first rather than losing edits
    // silently.
    if (pendingWriteCount() > 0) {
      setConfirmingSwitchTo(org);
      return;
    }
    void performSwitch(org);
  }

  if (collapsed) {
    // The rail keeps the workspace's identity as a one-letter tile.
    return (
      <span
        aria-label={label ?? t('workspaceSwitcher.title')}
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-brand-subtle text-xs font-semibold uppercase text-brand-subtle-foreground"
        role="img"
        title={label ?? undefined}
      >
        {label?.trim().charAt(0) ?? ''}
      </span>
    );
  }

  if (label === null || label === undefined) {
    return (
      <LoadingRegion className="min-w-0 flex-1">
        <Skeleton className="h-4 w-24" />
      </LoadingRegion>
    );
  }

  if (!orgs || orgs.length === 0) {
    return <span className="truncate text-sm font-semibold text-foreground">{label}</span>;
  }

  return (
    <>
      <SelectPopover
        align="left"
        // The header is a flex row; without min-w-0 the popover's wrapper
        // refuses to shrink and a long workspace name pushes the mobile
        // close button off the edge instead of truncating.
        className="min-w-0"
        panelClassName="w-64 py-1"
        triggerChildren={
          <>
            <span className="truncate">{label}</span>
            <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          </>
        }
        triggerClassName="flex min-w-0 items-center gap-1 rounded-md px-1.5 py-1 text-sm font-semibold text-foreground hover:bg-muted"
        triggerTitle={t('workspaceSwitcher.title')}
      >
        {close => (
          <>
            <p className="px-3 py-1.5 text-xs font-medium text-muted-foreground">
              {t('workspaceSwitcher.title')}
            </p>
            {orgs.map(org => (
              <button
                className={cn(
                  'flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-accent',
                  org.current && 'font-medium',
                )}
                disabled={switching !== null}
                key={org.id}
                onClick={() => {
                  close();
                  if (!org.current) {
                    requestSwitch(org);
                  }
                }}
                type="button"
              >
                <span className="min-w-0 flex-1 truncate">{org.name}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{org.role}</span>
                {org.current && <Check className="h-3.5 w-3.5 shrink-0" />}
              </button>
            ))}
            <div className="my-1 border-t border-border" />
            <Link
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
              href="/onboarding"
              onClick={close}
            >
              <Plus className="h-3.5 w-3.5 shrink-0" />
              {t('workspaceSwitcher.createWorkspace')}
            </Link>
          </>
        )}
      </SelectPopover>

      <ConfirmDialog
        confirmLabel={t('workspaceSwitcher.switchAnyway')}
        message={t('workspaceSwitcher.pendingWritesWarning')}
        onCancel={() => setConfirmingSwitchTo(null)}
        onConfirm={() => {
          const target = confirmingSwitchTo;
          setConfirmingSwitchTo(null);
          if (target) {
            void performSwitch(target);
          }
        }}
        open={confirmingSwitchTo !== null}
        title={t('workspaceSwitcher.pendingWritesTitle')}
      />
    </>
  );
}
