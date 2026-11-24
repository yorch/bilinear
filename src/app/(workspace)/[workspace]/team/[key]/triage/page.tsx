'use client';
import { ArrowLeft, Inbox } from 'lucide-react';

import { observer } from 'mobx-react-lite';
import Link from 'next/link';
import { useParams, usePathname } from 'next/navigation';
import { useCallback, useMemo, useRef, useState } from 'react';
import { TipTapEditor } from '@/components/editor/tiptap-editor.lazy';
import { IssuePicker } from '@/components/issues/issue-picker';
import { TriageDuplicateSuggestions } from '@/components/issues/triage-duplicate-suggestions';
import { TriageKeyHint } from '@/components/issues/triage-key-hint';
import {
  fetchIssueState,
  TRIAGE_ACCEPT_MUTATION,
  TRIAGE_DECLINE_MUTATION,
  TRIAGE_MARK_DUPLICATE_MUTATION,
  TRIAGE_REVERT_MUTATION,
  TRIAGE_SNOOZE_MUTATION,
  TriageStaleError,
  triageMutate,
} from '@/components/issues/triage-mutations';
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
import { isOverlayOpen, useHotkeys } from '@/hooks/use-hotkeys';
import { useIssueUpdate } from '@/hooks/use-issue-update';
import { useTranslations } from '@/hooks/use-translations';
import type { DBIssue } from '@/lib/db';
import { toIssueLabels, toIssueUsers } from '@/lib/issue-mappers';
import { buildIssueHref } from '@/lib/issue-nav';
import { toast } from '@/lib/toast';
import { cn, getErrorMessage, TOUCH_TARGET } from '@/lib/utils';
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
 *   - J / K move through the queue. Keys are inert while typing, while a
 *     popover or dialog is open (`isOverlayOpen`), and the decision keys
 *     ignore key auto-repeat so a held key cannot walk the whole queue.
 *   - Accept / Decline / Duplicate show an Undo toast (`issueTriageRevert`).
 */

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

  // Latest queue for handlers that run after an await (focus hand-off).
  const queueRef = useRef(queue);
  queueRef.current = queue;

  /** The row that should take focus once `issueId` leaves the queue: next, else previous. */
  const neighbourOf = useCallback((issueId: string): string | null => {
    const q = queueRef.current;
    const idx = q.findIndex(i => i.id === issueId);
    return q[idx + 1]?.id ?? q[idx - 1]?.id ?? null;
  }, []);

  /** Re-read one issue's lifecycle fields from the server into the store. */
  const adoptServerState = useCallback(
    async (issueId: string) => {
      const server = await fetchIssueState(issueId);
      if (server) {
        issueStore.optimisticUpdate(issueId, {
          canceledAt: server.canceledAt,
          snoozedUntilAt: server.snoozedUntilAt,
          stateId: server.stateId,
          triagedAt: server.triagedAt,
        });
      } else {
        // Unreadable (gone, or no access): the safe move is to stop offering it.
        issueStore.optimisticUpdate(issueId, {
          snoozedUntilAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        });
      }
    },
    [issueStore],
  );

  /** Undo a decision: the server puts the issue back in triage, we mirror it. */
  const handleUndo = useCallback(
    async (issueId: string) => {
      if (!triageStateId) {
        return;
      }
      const before = issueStore.findById(issueId);
      issueStore.optimisticUpdate(issueId, {
        canceledAt: null,
        snoozedUntilAt: null,
        stateId: triageStateId,
        triagedAt: null,
      });
      setFocusedId(issueId);
      try {
        await triageMutate(TRIAGE_REVERT_MUTATION, { issueId }, t('settings.triage.undoFailed'));
      } catch (err) {
        if (err instanceof TriageStaleError) {
          await adoptServerState(issueId);
          toast.error(t('settings.triage.undoExpired'));
        } else {
          if (before) {
            issueStore.optimisticUpdate(issueId, before);
          }
          toast.error(getErrorMessage(err, t('settings.triage.undoFailed')));
        }
      }
    },
    [adoptServerState, issueStore, t, triageStateId],
  );

  /**
   * One path for every decision. Optimistic patch → mutation → on a lost race
   * (`TriageStaleError`) adopt the server's state and say so, never restore
   * the stale snapshot; on any other error roll back to the snapshot.
   */
  const decide = useCallback(
    async (
      issueId: string,
      d: {
        failure: string;
        optimistic: Partial<DBIssue>;
        query: string;
        success?: (identifier: string) => string;
        variables: Record<string, unknown>;
      },
    ): Promise<boolean> => {
      const snapshot = issueStore.findById(issueId);
      setBusyId(issueId);
      setFocusedId(neighbourOf(issueId));
      issueStore.optimisticUpdate(issueId, d.optimistic);
      try {
        await triageMutate(d.query, { issueId, ...d.variables }, d.failure);
        if (d.success && snapshot) {
          toast.undo(d.success(snapshot.identifier), t('settings.triage.undo'), () => {
            void handleUndo(issueId);
          });
        }
        return true;
      } catch (err) {
        if (err instanceof TriageStaleError) {
          await adoptServerState(issueId);
          toast.info(t('settings.triage.alreadyHandled'));
        } else {
          if (snapshot) {
            issueStore.optimisticUpdate(issueId, snapshot);
            setFocusedId(issueId);
          }
          toast.error(getErrorMessage(err, d.failure));
        }
        return false;
      } finally {
        setBusyId(null);
      }
    },
    [adoptServerState, handleUndo, issueStore, neighbourOf, t],
  );

  const handleAccept = useCallback(
    (issueId: string) => {
      if (!defaultTargetStateId) {
        return Promise.resolve(false);
      }
      return decide(issueId, {
        failure: t('settings.triage.acceptFailed'),
        optimistic: { stateId: defaultTargetStateId },
        query: TRIAGE_ACCEPT_MUTATION,
        success: identifier => t('settings.triage.accepted', { identifier }),
        variables: { input: { stateId: defaultTargetStateId } },
      });
    },
    [decide, defaultTargetStateId, t],
  );

  const handleDecline = useCallback(
    (issueId: string) =>
      // Optimistic: hide from the queue with a synthetic snooze; the real
      // cancel arrives over the sync socket.
      decide(issueId, {
        failure: t('settings.triage.declineFailed'),
        optimistic: { snoozedUntilAt: new Date(Date.now() + 60 * 60 * 1000).toISOString() },
        query: TRIAGE_DECLINE_MUTATION,
        success: identifier => t('settings.triage.declined', { identifier }),
        variables: {},
      }),
    [decide, t],
  );

  const handleSnooze = useCallback(
    (issueId: string, hours: number) => {
      const until = new Date(Date.now() + hours * 60 * 60 * 1000);
      return decide(issueId, {
        failure: t('settings.triage.snoozeFailed'),
        optimistic: { snoozedUntilAt: until.toISOString() },
        query: TRIAGE_SNOOZE_MUTATION,
        variables: { until: until.toISOString() },
      });
    },
    [decide, t],
  );

  const submitMarkDuplicate = useCallback(
    async (issueId: string, canonical: Pick<DBIssue, 'id' | 'identifier'>) => {
      if (canonical.id === issueId) {
        toast.error(t('settings.triage.cannotMarkDuplicateOfItself'));
        return;
      }
      try {
        await decide(issueId, {
          failure: t('settings.triage.markDuplicateFailed'),
          optimistic: { snoozedUntilAt: new Date(Date.now() + 60 * 60 * 1000).toISOString() },
          query: TRIAGE_MARK_DUPLICATE_MUTATION,
          success: () =>
            t('settings.triage.markedAsDuplicate', { identifier: canonical.identifier }),
          variables: { canonicalIssueId: canonical.id },
        });
      } finally {
        setDuplicatePickerFor(null);
      }
    },
    [decide, t],
  );

  const handleMarkDuplicate = useCallback((issueId: string) => {
    setDuplicatePickerFor(issueId);
  }, []);

  // j/k move within the queue. 1/2/3 and a/m/d are the decisions (Accept,
  // Duplicate, Decline); h/s open the snooze menu, whose rows are then picked
  // with the arrow keys + Enter. Every action is skipped while a popover or
  // dialog is open so a digit typed at a menu — or behind the `?` help / `c`
  // create modal — can't also decide the hidden focused issue.
  const act = useCallback(
    (run: (issueId: string) => void) => {
      if (effectiveFocusedId && !busyId && !isOverlayOpen()) {
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

  // The row that LOOKS focused (the first one when nothing is explicitly
  // focused), so the first `j` moves off it rather than appearing to do nothing.
  const shownIndex = queue.findIndex(i => i.id === effectiveFocusedId);
  useHotkeys(
    'j',
    () => {
      if (isOverlayOpen()) {
        return;
      }
      const next = Math.min(shownIndex + 1, queue.length - 1);
      setFocusedId(queue[next]?.id ?? null);
    },
    { enabled: hasQueue },
    [shownIndex, queue],
  );
  useHotkeys(
    'k',
    () => {
      if (isOverlayOpen()) {
        return;
      }
      const prev = Math.max(shownIndex - 1, 0);
      setFocusedId(queue[prev]?.id ?? null);
    },
    { enabled: hasQueue },
    [shownIndex, queue],
  );
  useHotkeys(['1', 'a'], accept, { enabled: acceptEnabled, ignoreRepeat: true }, [accept]);
  useHotkeys(['2', 'm'], duplicate, { enabled: hasQueue, ignoreRepeat: true }, [duplicate]);
  useHotkeys(['3', 'd'], decline, { enabled: hasQueue, ignoreRepeat: true }, [decline]);
  useHotkeys(['h', 's'], snooze, { enabled: hasQueue, ignoreRepeat: true }, [snooze]);

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
                <Button
                  className={cn('gap-1 text-muted-foreground md:hidden', TOUCH_TARGET)}
                  onClick={() => setPreviewOpen(false)}
                  size="xs"
                  type="button"
                  variant="ghost"
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                  {t('settings.triage.backToQueue')}
                </Button>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    aria-keyshortcuts="1 A"
                    className={TOUCH_TARGET}
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
                    className={TOUCH_TARGET}
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
                      TOUCH_TARGET,
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
                  className={cn(
                    'text-xs text-muted-foreground hover:text-foreground',
                    TOUCH_TARGET,
                  )}
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
