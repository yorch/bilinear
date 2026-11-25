'use client';

import { useState } from 'react';
import type { OpenProperty } from '@/components/issues/issue-row';
import { useHotkeys } from '@/hooks/use-hotkeys';
import { useTranslations } from '@/hooks/use-translations';
import { toast } from '@/lib/toast';
import { useStore } from '@/providers/store-provider';

interface UseIssueShortcutsOptions {
  /** Shortcuts are inert while false (e.g. before the issue has loaded). */
  enabled?: boolean;
  /** The issue's identifier, copied by Cmd/Ctrl+. */
  identifier?: string;
  issueId?: string;
  /** Backspace / Delete. Omit where the surface cannot archive. */
  onArchive?: () => void;
  onUpdate?: (id: string, patch: Record<string, unknown>) => void;
}

/**
 * The single-issue shortcut set for a surface that shows one issue with its
 * properties on screen (the full-page issue view): S / A / P / L / D /
 * Shift+E / Shift+P / Q open the matching property popover, I assigns to the
 * viewer, Backspace archives and Cmd/Ctrl+. copies the identifier.
 *
 * The list pages bind the same keys against the *selected row* in
 * `useIssueListPage`; this is the counterpart for a page that has no
 * selection, because the issue it shows is always the target. The caller
 * threads `openProperty` into the pickers as `forceOpen`/`open` and
 * `closeProperty` as their `onClose`, so a second press re-opens.
 */
export function useIssueShortcuts({
  enabled = true,
  identifier,
  issueId,
  onArchive,
  onUpdate,
}: UseIssueShortcutsOptions) {
  const t = useTranslations();
  const { userStore } = useStore();
  const [openProperty, setOpenProperty] = useState<OpenProperty>(null);
  const active = enabled && Boolean(issueId);
  const options = { enabled: active };

  useHotkeys('s', () => setOpenProperty('status'), options, [active]);
  useHotkeys('a', () => setOpenProperty('assignee'), options, [active]);
  useHotkeys('p', () => setOpenProperty('priority'), options, [active]);
  useHotkeys('l', () => setOpenProperty('label'), options, [active]);
  useHotkeys('d', () => setOpenProperty('dueDate'), options, [active]);
  useHotkeys('shift+e', () => setOpenProperty('estimate'), options, [active]);
  useHotkeys('shift+p', () => setOpenProperty('project'), options, [active]);
  useHotkeys('q', () => setOpenProperty('cycle'), options, [active]);

  useHotkeys(
    'i',
    () => {
      const me = userStore.currentUser?.id;
      if (issueId && me && onUpdate) {
        onUpdate(issueId, { assigneeId: me });
      }
    },
    { enabled: active && Boolean(onUpdate) },
    [active, issueId, onUpdate, userStore],
  );

  useHotkeys(
    ['backspace', 'delete'],
    () => onArchive?.(),
    { enabled: active && Boolean(onArchive) },
    [active, onArchive],
  );

  useHotkeys(
    ['meta+.', 'ctrl+.'],
    () => {
      if (!identifier) {
        return;
      }
      navigator.clipboard
        .writeText(identifier)
        .then(() => toast.success(t('issues.idCopied', { identifier })))
        .catch(() => toast.error(t('issueDetail.properties.copyFailed')));
    },
    { enabled: active && Boolean(identifier) },
    [active, identifier, t],
  );

  return { closeProperty: () => setOpenProperty(null), openProperty };
}
