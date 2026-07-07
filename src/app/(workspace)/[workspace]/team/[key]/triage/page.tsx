'use client';

import { observer } from 'mobx-react-lite';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { IssuePicker } from '@/components/issues/issue-picker';
import { useFormatters } from '@/hooks/use-formatters';
import { useHotkeys } from '@/hooks/use-hotkeys';
import { useOutsideClick } from '@/hooks/use-outside-click';
import { useTranslations } from '@/hooks/use-translations';
import type { DBIssue } from '@/lib/db';
import { gql } from '@/lib/graphql';
import { toast } from '@/lib/toast';
import { cn, getErrorMessage } from '@/lib/utils';
import { useStore } from '@/providers/store-provider';

/**
 * Triage queue for a triage-enabled team. Issues created without an explicit
 * state on a triage-enabled team default to the triage state and surface here.
 *
 * Actions:
 *   - Accept   → move to a target workflow state (typically backlog)
 *   - Decline  → cancel the issue
 *   - Snooze   → hide from queue until a future timestamp
 *   - Mark dup → mark as duplicate of another issue and cancel
 */

const TRIAGE_ACCEPT_MUTATION = `
  mutation TriageAccept($issueId: ID!, $input: IssueTriageAcceptInput!) {
    issueTriageAccept(issueId: $issueId, input: $input) {
      success
      lastSyncId
      issue { id stateId triagedAt }
    }
  }
`;

const TRIAGE_DECLINE_MUTATION = `
  mutation TriageDecline($issueId: ID!) {
    issueTriageDecline(issueId: $issueId) {
      success
      lastSyncId
      issue { id stateId canceledAt triagedAt }
    }
  }
`;

const TRIAGE_MARK_DUPLICATE_MUTATION = `
  mutation TriageMarkDuplicate($issueId: ID!, $canonicalIssueId: ID!) {
    issueTriageMarkDuplicate(issueId: $issueId, canonicalIssueId: $canonicalIssueId) {
      success
      lastSyncId
      issue { id stateId canceledAt triagedAt }
    }
  }
`;

const TRIAGE_SNOOZE_MUTATION = `
  mutation TriageSnooze($issueId: ID!, $until: DateTime!) {
    issueTriageSnooze(issueId: $issueId, until: $until) {
      success
      lastSyncId
      issue { id snoozedUntilAt }
    }
  }
`;

const SNOOZE_PRESETS: Array<{ labelKey: string; hours: number }> = [
  { hours: 4, labelKey: 'settings.triage.snooze4Hours' },
  { hours: 24, labelKey: 'settings.triage.snooze1Day' },
  { hours: 168, labelKey: 'settings.triage.snooze1Week' },
];

/**
 * Click-to-open popover with preset items. Replaces an earlier
 * `group-hover:block` approach that was inaccessible on touch devices
 * and dismissed before the click could register on some browsers.
 */
function SnoozeButton({
  disabled,
  onSelect,
}: {
  disabled: boolean;
  onSelect: (hours: number) => void;
}) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useOutsideClick(ref, () => setOpen(false), open);
  useEffect(() => {
    if (!open) {
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        className="rounded border border-border px-2.5 py-1 text-xs text-zinc-700 hover:bg-muted disabled:opacity-50 dark:text-zinc-300"
        disabled={disabled}
        onClick={() => setOpen(o => !o)}
        type="button"
      >
        {t('settings.triage.snooze')}
      </button>
      {open ? (
        <div
          className="absolute right-0 z-10 mt-1 min-w-[120px] rounded border border-border bg-card py-1 text-xs shadow-lg"
          role="menu"
        >
          {SNOOZE_PRESETS.map(p => (
            <button
              className="block w-full px-3 py-1 text-left text-zinc-700 hover:bg-muted dark:text-zinc-300"
              key={p.hours}
              onClick={() => {
                setOpen(false);
                onSelect(p.hours);
              }}
              role="menuitem"
              type="button"
            >
              {t(p.labelKey)}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

const TriagePage = observer(function TriagePage() {
  const { key: teamKey } = useParams<{ workspace: string; key: string }>();
  const { issueStore, teamStore, workflowStateStore, userStore, syncStore } = useStore();
  const t = useTranslations();
  const { formatDate } = useFormatters();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [duplicatePickerFor, setDuplicatePickerFor] = useState<string | null>(null);

  const team = teamStore.findByKey(teamKey);
  const teamId = team?.id ?? null;

  // The triage state for this team (if triage is enabled).
  const triageStateId = useMemo(() => {
    if (!teamId) {
      return null;
    }
    return workflowStateStore.findByTeamId(teamId).find(s => s.type === 'triage')?.id ?? null;
  }, [teamId, workflowStateStore]);

  // Default target state on accept: the team's first backlog state.
  const defaultTargetStateId = useMemo(() => {
    if (!teamId) {
      return null;
    }
    return workflowStateStore.findByTeamId(teamId).find(s => s.type === 'backlog')?.id ?? null;
  }, [teamId, workflowStateStore]);

  // Compute inline (no useMemo) so the wrapping `observer` re-runs the
  // selector on every observable change in `issueStore.pool`. With useMemo,
  // optimisticUpdate (which mutates pool entries without changing pool.size)
  // would not invalidate the cached queue and accept/decline/snooze on a
  // post-bootstrap issue would leave the row visible even after the state
  // patch landed.
  const now = Date.now();
  const queue =
    !teamId || !triageStateId
      ? []
      : issueStore
          .findByTeamId(teamId)
          .filter(
            i =>
              i.stateId === triageStateId &&
              (!i.snoozedUntilAt || new Date(i.snoozedUntilAt).getTime() <= now),
          )
          .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  // Falls back to the first row whenever the explicitly-focused issue has
  // left the queue (accepted/declined/snoozed elsewhere, or on first load).
  const focusedIndex = queue.findIndex(i => i.id === focusedId);
  const effectiveFocusedId = focusedIndex >= 0 ? focusedId : (queue[0]?.id ?? null);

  /** Snapshot the issue so we can roll back optimistic edits on error. */
  const handleAccept = useCallback(
    async (issueId: string) => {
      if (!defaultTargetStateId) {
        return;
      }
      const snapshot = issueStore.findById(issueId);
      setBusyId(issueId);
      // Optimistic: remove from triage queue immediately.
      issueStore.optimisticUpdate(issueId, { stateId: defaultTargetStateId });
      try {
        const res = await gql(TRIAGE_ACCEPT_MUTATION, {
          input: { stateId: defaultTargetStateId },
          issueId,
        });
        if (res.errors?.length) {
          throw new Error(
            (res.errors[0] as { message?: string })?.message ?? t('settings.triage.acceptFailed'),
          );
        }
      } catch (err) {
        if (snapshot) {
          issueStore.optimisticUpdate(issueId, snapshot);
        }
        toast.error(getErrorMessage(err, t('settings.triage.acceptFailed')));
      } finally {
        setBusyId(null);
      }
    },
    [defaultTargetStateId, issueStore, t],
  );

  const handleDecline = useCallback(
    async (issueId: string) => {
      const snapshot = issueStore.findById(issueId);
      setBusyId(issueId);
      // Optimistic: hide from queue while the request is in flight.
      // We mark with a synthetic snoozedUntilAt far in the future so the
      // queue filter excludes it; the real cancel arrives via WS.
      issueStore.optimisticUpdate(issueId, {
        snoozedUntilAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      });
      try {
        const res = await gql(TRIAGE_DECLINE_MUTATION, { issueId });
        if (res.errors?.length) {
          throw new Error(
            (res.errors[0] as { message?: string })?.message ?? t('settings.triage.declineFailed'),
          );
        }
      } catch (err) {
        if (snapshot) {
          issueStore.optimisticUpdate(issueId, snapshot);
        }
        toast.error(getErrorMessage(err, t('settings.triage.declineFailed')));
      } finally {
        setBusyId(null);
      }
    },
    [issueStore, t],
  );

  const handleSnooze = useCallback(
    async (issueId: string, hours: number) => {
      const snapshot = issueStore.findById(issueId);
      const until = new Date(Date.now() + hours * 60 * 60 * 1000);
      setBusyId(issueId);
      issueStore.optimisticUpdate(issueId, { snoozedUntilAt: until.toISOString() });
      try {
        const res = await gql(TRIAGE_SNOOZE_MUTATION, {
          issueId,
          until: until.toISOString(),
        });
        if (res.errors?.length) {
          throw new Error(
            (res.errors[0] as { message?: string })?.message ?? t('settings.triage.snoozeFailed'),
          );
        }
      } catch (err) {
        if (snapshot) {
          issueStore.optimisticUpdate(issueId, snapshot);
        }
        toast.error(getErrorMessage(err, t('settings.triage.snoozeFailed')));
      } finally {
        setBusyId(null);
      }
    },
    [issueStore, t],
  );

  const submitMarkDuplicate = useCallback(
    async (issueId: string, canonical: DBIssue) => {
      if (canonical.id === issueId) {
        toast.error(t('settings.triage.cannotMarkDuplicateOfItself'));
        return;
      }
      const snapshot = issueStore.findById(issueId);
      setBusyId(issueId);
      issueStore.optimisticUpdate(issueId, {
        snoozedUntilAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      });
      try {
        const res = await gql(TRIAGE_MARK_DUPLICATE_MUTATION, {
          canonicalIssueId: canonical.id,
          issueId,
        });
        if (res.errors?.length) {
          throw new Error(
            (res.errors[0] as { message?: string })?.message ??
              t('settings.triage.markDuplicateFailed'),
          );
        }
        toast.success(t('settings.triage.markedAsDuplicate', { identifier: canonical.identifier }));
      } catch (err) {
        if (snapshot) {
          issueStore.optimisticUpdate(issueId, snapshot);
        }
        toast.error(getErrorMessage(err, t('settings.triage.markDuplicateFailed')));
      } finally {
        setBusyId(null);
        setDuplicatePickerFor(null);
      }
    },
    [issueStore, t],
  );

  const handleMarkDuplicate = useCallback((issueId: string) => {
    setDuplicatePickerFor(issueId);
  }, []);

  // j/k — move focus within the queue; a/d/s/m act on the focused issue.
  // Snooze defaults to the shortest preset since a keyboard shortcut can't
  // drive the picker popover; the button remains for the other presets.
  useHotkeys(
    'j',
    () => {
      const next = Math.min(focusedIndex + 1, queue.length - 1);
      setFocusedId(queue[next]?.id ?? null);
    },
    { enabled: queue.length > 0 },
    [focusedIndex, queue],
  );
  useHotkeys(
    'k',
    () => {
      const prev = Math.max(focusedIndex - 1, 0);
      setFocusedId(queue[prev]?.id ?? null);
    },
    { enabled: queue.length > 0 },
    [focusedIndex, queue],
  );
  useHotkeys(
    'a',
    () => {
      if (effectiveFocusedId && !busyId) {
        handleAccept(effectiveFocusedId);
      }
    },
    { enabled: queue.length > 0 && Boolean(defaultTargetStateId) },
    [effectiveFocusedId, busyId, handleAccept, queue.length, defaultTargetStateId],
  );
  useHotkeys(
    'd',
    () => {
      if (effectiveFocusedId && !busyId) {
        handleDecline(effectiveFocusedId);
      }
    },
    { enabled: queue.length > 0 },
    [effectiveFocusedId, busyId, handleDecline, queue.length],
  );
  useHotkeys(
    's',
    () => {
      if (effectiveFocusedId && !busyId) {
        handleSnooze(effectiveFocusedId, SNOOZE_PRESETS[0].hours);
      }
    },
    { enabled: queue.length > 0 },
    [effectiveFocusedId, busyId, handleSnooze, queue.length],
  );
  useHotkeys(
    'm',
    () => {
      if (effectiveFocusedId && !busyId) {
        handleMarkDuplicate(effectiveFocusedId);
      }
    },
    { enabled: queue.length > 0 },
    [effectiveFocusedId, busyId, handleMarkDuplicate, queue.length],
  );

  const isLoading = syncStore.status === 'bootstrapping' || syncStore.status === 'idle';

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        {t('common.loading')}
      </div>
    );
  }

  if (!team) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        {t('settings.triage.teamNotFound')}
      </div>
    );
  }

  if (!triageStateId) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
        <p>{t('settings.triage.triageNotEnabled')}</p>
        <p className="text-xs">{t('settings.triage.triageNotEnabledHint')}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b border-border px-6 py-3">
        <h1 className="text-sm font-semibold text-foreground">
          {t('settings.triage.pageTitle', { name: team.displayName ?? team.name })}
        </h1>
        <span className="text-xs text-muted-foreground">
          {t('settings.triage.toTriageCount', { count: queue.length })}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto">
        {queue.length === 0 ? (
          <div className="flex items-center justify-center py-20 text-sm text-muted-foreground">
            {t('settings.triage.allClear')}
          </div>
        ) : (
          queue.map(issue => {
            const creator = issue.creatorId ? userStore.findById(issue.creatorId) : null;
            const busy = busyId === issue.id;
            const focused = issue.id === effectiveFocusedId;
            return (
              <div
                className={cn(
                  'flex items-center gap-3 border-b border-border px-4 py-3',
                  focused && 'bg-accent/50',
                )}
                key={issue.id}
              >
                <span className="w-16 flex-shrink-0 text-xs text-muted-foreground">
                  {issue.identifier}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-foreground">{issue.title}</div>
                  {creator ? (
                    <div className="text-xs text-muted-foreground">
                      {t('settings.triage.fromCreator', {
                        date: formatDate(issue.createdAt),
                        name: creator.displayName,
                      })}
                    </div>
                  ) : null}
                </div>
                <div className="flex flex-shrink-0 gap-1">
                  <button
                    className="rounded bg-primary px-2.5 py-1 text-xs text-white hover:bg-primary/90 disabled:opacity-50"
                    disabled={busy || !defaultTargetStateId}
                    onClick={() => handleAccept(issue.id)}
                    type="button"
                  >
                    {t('settings.triage.accept')}
                  </button>
                  <button
                    className="rounded border border-border px-2.5 py-1 text-xs text-zinc-700 hover:bg-muted disabled:opacity-50 dark:text-zinc-300"
                    disabled={busy}
                    onClick={() => handleDecline(issue.id)}
                    type="button"
                  >
                    {t('settings.triage.decline')}
                  </button>
                  <IssuePicker
                    disabled={busy}
                    excludeId={issue.id}
                    forceOpen={duplicatePickerFor === issue.id}
                    onClose={() => setDuplicatePickerFor(null)}
                    onSelect={canonical => submitMarkDuplicate(issue.id, canonical)}
                    triggerChildren={t('settings.triage.duplicate')}
                    triggerClassName="rounded border border-border px-2.5 py-1 text-xs text-zinc-700 hover:bg-muted dark:text-zinc-300"
                    triggerTitle={t('settings.triage.markDuplicateTitle')}
                  />
                  <SnoozeButton disabled={busy} onSelect={hours => handleSnooze(issue.id, hours)} />
                </div>
              </div>
            );
          })
        )}
      </div>

      {queue.length > 0 && (
        <div className="flex items-center gap-3 border-t border-border px-4 py-1.5 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <kbd className="rounded border px-1 font-mono">J</kbd>
            <kbd className="rounded border px-1 font-mono">K</kbd>
            {t('commandPalette.footer.navigate')}
          </span>
          <span className="flex items-center gap-1">
            <kbd className="rounded border px-1 font-mono">A</kbd>
            {t('settings.triage.accept')}
          </span>
          <span className="flex items-center gap-1">
            <kbd className="rounded border px-1 font-mono">D</kbd>
            {t('settings.triage.decline')}
          </span>
          <span className="flex items-center gap-1">
            <kbd className="rounded border px-1 font-mono">S</kbd>
            {t('settings.triage.snooze')}
          </span>
          <span className="flex items-center gap-1">
            <kbd className="rounded border px-1 font-mono">M</kbd>
            {t('settings.triage.duplicate')}
          </span>
        </div>
      )}
    </div>
  );
});

export default TriagePage;
