'use client';
import { ArrowLeft, Inbox } from 'lucide-react';

import { observer } from 'mobx-react-lite';
import Link from 'next/link';
import { useParams, usePathname } from 'next/navigation';
import { useCallback, useMemo, useState } from 'react';
import { TipTapEditor } from '@/components/editor/tiptap-editor.lazy';
import { IssuePicker } from '@/components/issues/issue-picker';
import { TriageDuplicateSuggestions } from '@/components/issues/triage-duplicate-suggestions';
import { TriageKeyHint } from '@/components/issues/triage-key-hint';
import { TriageSnoozeMenu } from '@/components/issues/triage-snooze-menu';
import { AssigneeSelect } from '@/components/properties/assignee-select';
import { LabelSelect } from '@/components/properties/label-select';
import { PriorityIcon } from '@/components/properties/priority-icon';
import { PrioritySelect } from '@/components/properties/priority-select';
import { Button, buttonVariants } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader, Toolbar } from '@/components/ui/page-header';
import { PageSkeleton } from '@/components/ui/skeleton';
import { useDocumentTitle } from '@/hooks/use-document-title';
import { useFormatters } from '@/hooks/use-formatters';
import { useHotkeys } from '@/hooks/use-hotkeys';
import { useIssueUpdate } from '@/hooks/use-issue-update';
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
 *   - Accept   → move to a target workflow state (typically backlog)   [1 / A]
 *   - Mark dup → mark as duplicate of another issue and cancel        [2 / M]
 *   - Decline  → cancel the issue                                      [3 / D]
 *   - Snooze   → hide from queue until a future timestamp (menu)       [H / S]
 *   - J / K move through the queue. Keys are inert while typing or while a
 *     popover is open (see `useHotkeys` and `isPopoverOpen`).
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

/** True while any popover (priority, label, duplicate picker, snooze…) is open. */
function isPopoverOpen(): boolean {
  return document.querySelector('[aria-haspopup][aria-expanded="true"]') !== null;
}

const TriagePage = observer(function TriagePage() {
  const { key: teamKey, workspace } = useParams<{ workspace: string; key: string }>();
  const pathname = usePathname();
  const { issueStore, teamStore, workflowStateStore, userStore, labelStore, syncStore } =
    useStore();
  const handleUpdate = useIssueUpdate();
  const t = useTranslations();
  const { formatRelativeTime } = useFormatters();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [duplicatePickerFor, setDuplicatePickerFor] = useState<string | null>(null);
  const [snoozeOpenFor, setSnoozeOpenFor] = useState<string | null>(null);
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
    async (issueId: string, canonical: Pick<DBIssue, 'id' | 'identifier'>) => {
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

  // j/k move within the queue. 1/2/3 and a/m/d are the decisions (Accept,
  // Duplicate, Decline); h/s open the snooze menu, whose rows are then picked
  // with the arrow keys + Enter. Every action is skipped while another
  // popover is open so a digit typed at a menu can't also decide the issue.
  const act = useCallback(
    (run: (issueId: string) => void) => {
      if (effectiveFocusedId && !busyId && !isPopoverOpen()) {
        run(effectiveFocusedId);
      }
    },
    [effectiveFocusedId, busyId],
  );
  const hasQueue = queue.length > 0;
  const acceptEnabled = hasQueue && Boolean(defaultTargetStateId);
  const accept = useCallback(() => act(handleAccept), [act, handleAccept]);
  const decline = useCallback(() => act(handleDecline), [act, handleDecline]);
  const duplicate = useCallback(() => act(handleMarkDuplicate), [act, handleMarkDuplicate]);
  const snooze = useCallback(() => act(setSnoozeOpenFor), [act]);

  useHotkeys(
    'j',
    () => {
      if (isPopoverOpen()) {
        return;
      }
      const next = Math.min(focusedIndex + 1, queue.length - 1);
      setFocusedId(queue[next]?.id ?? null);
    },
    { enabled: hasQueue },
    [focusedIndex, queue],
  );
  useHotkeys(
    'k',
    () => {
      if (isPopoverOpen()) {
        return;
      }
      const prev = Math.max(focusedIndex - 1, 0);
      setFocusedId(queue[prev]?.id ?? null);
    },
    { enabled: hasQueue },
    [focusedIndex, queue],
  );
  useHotkeys(['1', 'a'], accept, { enabled: acceptEnabled }, [accept]);
  useHotkeys(['2', 'm'], duplicate, { enabled: hasQueue }, [duplicate]);
  useHotkeys(['3', 'd'], decline, { enabled: hasQueue }, [decline]);
  useHotkeys(['h', 's'], snooze, { enabled: hasQueue }, [snooze]);

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
                        date: formatRelativeTime(issue.createdAt),
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
                    aria-keyshortcuts="1 A"
                    disabled={Boolean(busyId) || !defaultTargetStateId}
                    onClick={() => handleAccept(focusedIssue.id)}
                    size="sm"
                    type="button"
                  >
                    {t('settings.triage.accept')}
                    <TriageKeyHint>1</TriageKeyHint>
                  </Button>
                  <Button
                    aria-keyshortcuts="3 D"
                    disabled={Boolean(busyId)}
                    onClick={() => handleDecline(focusedIssue.id)}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    {t('settings.triage.decline')}
                    <TriageKeyHint>3</TriageKeyHint>
                  </Button>
                  <IssuePicker
                    disabled={Boolean(busyId)}
                    excludeId={focusedIssue.id}
                    forceOpen={duplicatePickerFor === focusedIssue.id}
                    onClose={() => setDuplicatePickerFor(null)}
                    onSelect={canonical => submitMarkDuplicate(focusedIssue.id, canonical)}
                    triggerChildren={
                      <>
                        {t('settings.triage.duplicate')}
                        <TriageKeyHint>2</TriageKeyHint>
                      </>
                    }
                    // `text-foreground` is explicit: the picker's own trigger
                    // classes carry `text-muted-foreground`, which survives the
                    // class merge and made this button read as disabled.
                    triggerClassName={cn(
                      buttonVariants({ size: 'sm', variant: 'outline' }),
                      'text-foreground',
                    )}
                    triggerTitle={t('settings.triage.markDuplicateTitle')}
                  />
                  <TriageSnoozeMenu
                    disabled={Boolean(busyId)}
                    forceOpen={snoozeOpenFor === focusedIssue.id}
                    onClose={() => setSnoozeOpenFor(null)}
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

                <TriageDuplicateSuggestions
                  disabled={Boolean(busyId)}
                  issueId={focusedIssue.id}
                  issueTitle={focusedIssue.title}
                  onMarkDuplicate={canonical => submitMarkDuplicate(focusedIssue.id, canonical)}
                />
              </div>
            </div>
          ) : null}
        </div>
      )}

      {queue.length > 0 && (
        <div className="flex items-center gap-3 border-t border-border px-4 py-1.5 text-[10px] text-muted-foreground max-md:hidden [@media(hover:none)]:hidden">
          <span className="flex items-center gap-1">
            <kbd className="rounded border border-border px-1 font-mono">J</kbd>
            <kbd className="rounded border border-border px-1 font-mono">K</kbd>
            {t('commandPalette.footer.navigate')}
          </span>
          {[
            ['1', 'settings.triage.accept'],
            ['2', 'settings.triage.duplicate'],
            ['3', 'settings.triage.decline'],
            ['H', 'settings.triage.snooze'],
          ].map(([key, labelKey]) => (
            <span className="flex items-center gap-1" key={key}>
              <kbd className="rounded border border-border px-1 font-mono">{key}</kbd>
              {t(labelKey)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
});

export default TriagePage;
