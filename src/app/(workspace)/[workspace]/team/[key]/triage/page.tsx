'use client';
import { ArrowLeft, Inbox } from 'lucide-react';

import { observer } from 'mobx-react-lite';
import Link from 'next/link';
import { useParams, usePathname } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { TipTapEditor } from '@/components/editor/tiptap-editor.lazy';
import { IssuePicker } from '@/components/issues/issue-picker';
import { AssigneeSelect } from '@/components/properties/assignee-select';
import { LabelSelect } from '@/components/properties/label-select';
import { PriorityIcon } from '@/components/properties/priority-icon';
import { PrioritySelect } from '@/components/properties/priority-select';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader, Toolbar } from '@/components/ui/page-header';
import { PageSkeleton } from '@/components/ui/skeleton';
import { useDocumentTitle } from '@/hooks/use-document-title';
import { useFormatters } from '@/hooks/use-formatters';
import { useHotkeys } from '@/hooks/use-hotkeys';
import { useIssueUpdate } from '@/hooks/use-issue-update';
import { useOutsideClick } from '@/hooks/use-outside-click';
import { useTranslations } from '@/hooks/use-translations';
import type { DBIssue } from '@/lib/db';
import { gql } from '@/lib/graphql';
import { toIssueLabels, toIssueUsers } from '@/lib/issue-mappers';
import { buildIssueHref } from '@/lib/issue-nav';
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
        className="rounded border border-border px-2.5 py-1 text-xs text-foreground-secondary hover:bg-muted disabled:opacity-50"
        disabled={disabled}
        onClick={() => setOpen(o => !o)}
        type="button"
      >
        {t('settings.triage.snooze')}
      </button>
      {open ? (
        <div
          className="absolute right-0 z-10 mt-1 min-w-[120px] rounded border border-border bg-card py-1 text-xs shadow-e2"
          role="menu"
        >
          {SNOOZE_PRESETS.map(p => (
            <button
              className="block w-full px-3 py-1 text-left text-foreground-secondary hover:bg-muted"
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
  const { key: teamKey, workspace } = useParams<{ workspace: string; key: string }>();
  const pathname = usePathname();
  const { issueStore, teamStore, workflowStateStore, userStore, labelStore, syncStore } =
    useStore();
  const handleUpdate = useIssueUpdate();
  const t = useTranslations();
  const { formatDate } = useFormatters();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [duplicatePickerFor, setDuplicatePickerFor] = useState<string | null>(null);
  // Below md the queue and the preview take turns; at md+ both are always on.
  const [previewOpen, setPreviewOpen] = useState(false);

  const team = teamStore.findByKey(teamKey);
  const teamId = team?.id ?? null;

  useDocumentTitle(
    team ? t('settings.triage.pageTitle', { name: team.displayName ?? team.name }) : null,
  );

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
  const focusedIssue = queue.find(i => i.id === effectiveFocusedId) ?? null;

  // Picker options for the preview pane. Plain reads — observer() tracks them.
  const users = toIssueUsers(userStore.all);
  const labels = toIssueLabels(labelStore.all);

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
    return <PageSkeleton />;
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
      {/* The count keeps its "{n} to triage" label rather than collapsing to a
          bare number: on a queue page the unit is the point, and five e2e
          specs read it as the page's ready signal. */}
      <PageHeader
        actions={
          <span className="text-xs text-muted-foreground">
            {t('settings.triage.toTriageCount', { count: queue.length })}
          </span>
        }
        title={t('settings.triage.pageTitle', { name: team.displayName ?? team.name })}
      />

      {queue.length === 0 ? (
        <EmptyState
          description={t('settings.triage.allClearDescription')}
          icon={<Inbox className="h-5 w-5" />}
          testId="empty-state"
          title={t('settings.triage.allClearTitle')}
        />
      ) : (
        /* Two panes: the queue on the left, the focused issue on the right.
           Triage used to be a flat list where every row carried four
           always-visible buttons and showed nothing but a title — so the one
           decision the page exists for (is this real work?) could not be made
           without leaving the page and opening the issue. The decision now sits
           beside the thing being decided. */
        <div className="flex min-h-0 flex-1">
          <div
            className={cn(
              'overflow-y-auto md:w-72 md:shrink-0 md:border-r md:border-border lg:w-80',
              // One pane at a time below md: the queue, or the issue.
              previewOpen ? 'hidden md:block' : 'w-full',
            )}
          >
            {queue.map(issue => {
              const creator = issue.creatorId ? userStore.findById(issue.creatorId) : null;
              const focused = issue.id === effectiveFocusedId;
              return (
                <button
                  aria-current={focused ? 'true' : undefined}
                  className={cn(
                    'flex w-full flex-col gap-0.5 border-b border-border px-4 py-3 text-left transition-colors',
                    focused ? 'bg-brand-subtle' : 'hover:bg-accent/50',
                  )}
                  data-testid="triage-row"
                  key={issue.id}
                  onClick={() => {
                    setFocusedId(issue.id);
                    setPreviewOpen(true);
                  }}
                  type="button"
                >
                  <div className="flex items-center gap-2">
                    <PriorityIcon className="h-3.5 w-3.5" priority={issue.priority} />
                    <span className="font-mono text-xs text-muted-foreground">
                      {issue.identifier}
                    </span>
                  </div>
                  <span className="line-clamp-2 text-sm text-foreground">{issue.title}</span>
                  {creator ? (
                    <span className="text-xs text-muted-foreground">
                      {t('settings.triage.fromCreator', {
                        date: formatDate(issue.createdAt),
                        name: creator.displayName,
                      })}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>

          {focusedIssue ? (
            <div
              className={cn(
                'min-w-0 flex-1 flex-col overflow-hidden',
                previewOpen ? 'flex' : 'hidden md:flex',
              )}
            >
              {/* One set of actions, for the issue on screen — not four buttons
                  on every row of the queue. */}
              <Toolbar className="justify-between">
                <button
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground md:hidden"
                  onClick={() => setPreviewOpen(false)}
                  type="button"
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                  {t('settings.triage.backToQueue')}
                </button>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    disabled={Boolean(busyId) || !defaultTargetStateId}
                    onClick={() => handleAccept(focusedIssue.id)}
                    size="sm"
                    type="button"
                  >
                    {t('settings.triage.accept')}
                  </Button>
                  <Button
                    disabled={Boolean(busyId)}
                    onClick={() => handleDecline(focusedIssue.id)}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    {t('settings.triage.decline')}
                  </Button>
                  <IssuePicker
                    disabled={Boolean(busyId)}
                    excludeId={focusedIssue.id}
                    forceOpen={duplicatePickerFor === focusedIssue.id}
                    onClose={() => setDuplicatePickerFor(null)}
                    onSelect={canonical => submitMarkDuplicate(focusedIssue.id, canonical)}
                    triggerChildren={t('settings.triage.duplicate')}
                    triggerClassName="rounded-md border border-border px-2.5 py-1 text-xs text-foreground-secondary hover:bg-muted"
                    triggerTitle={t('settings.triage.markDuplicateTitle')}
                  />
                  <SnoozeButton
                    disabled={Boolean(busyId)}
                    onSelect={hours => handleSnooze(focusedIssue.id, hours)}
                  />
                </div>
                <Link
                  className="text-xs text-muted-foreground hover:text-foreground"
                  href={buildIssueHref(workspace, focusedIssue.id, {
                    label: t('nav.triage'),
                    path: pathname,
                  })}
                >
                  {t('settings.triage.openFullIssue')}
                </Link>
              </Toolbar>

              <div className="min-w-0 flex-1 overflow-y-auto px-6 py-5">
                <h2 className="text-xl font-semibold leading-snug tracking-tight text-foreground">
                  {focusedIssue.title}
                </h2>

                {/* The properties worth setting *while* triaging. Status is
                    absent on purpose: Accept is the status change. */}
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <PrioritySelect
                    onChange={priority => handleUpdate(focusedIssue.id, { priority })}
                    value={focusedIssue.priority}
                  />
                  <AssigneeSelect
                    onChange={assigneeId => handleUpdate(focusedIssue.id, { assigneeId })}
                    users={users}
                    value={focusedIssue.assigneeId}
                  />
                  <LabelSelect
                    labels={labels}
                    onChange={labelIds => handleUpdate(focusedIssue.id, { labelIds })}
                    value={focusedIssue.labelIds ?? []}
                  />
                </div>

                <div className="mt-5">
                  {focusedIssue.description ? (
                    <TipTapEditor
                      className="text-sm"
                      content={focusedIssue.description}
                      readOnly
                      showToolbar={false}
                    />
                  ) : (
                    <p className="text-sm italic text-muted-foreground">
                      {t('settings.triage.noDescription')}
                    </p>
                  )}
                </div>
              </div>
            </div>
          ) : null}
        </div>
      )}

      {queue.length > 0 && (
        <div className="flex items-center gap-3 border-t border-border px-4 py-1.5 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <kbd className="rounded border border-border px-1 font-mono">J</kbd>
            <kbd className="rounded border border-border px-1 font-mono">K</kbd>
            {t('commandPalette.footer.navigate')}
          </span>
          <span className="flex items-center gap-1">
            <kbd className="rounded border border-border px-1 font-mono">A</kbd>
            {t('settings.triage.accept')}
          </span>
          <span className="flex items-center gap-1">
            <kbd className="rounded border border-border px-1 font-mono">D</kbd>
            {t('settings.triage.decline')}
          </span>
          <span className="flex items-center gap-1">
            <kbd className="rounded border border-border px-1 font-mono">S</kbd>
            {t('settings.triage.snooze')}
          </span>
          <span className="flex items-center gap-1">
            <kbd className="rounded border border-border px-1 font-mono">M</kbd>
            {t('settings.triage.duplicate')}
          </span>
        </div>
      )}
    </div>
  );
});

export default TriagePage;
