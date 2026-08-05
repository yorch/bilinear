'use client';

import { ArrowLeft, Bell, BellOff } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { priorityLabelKey } from '@/components/properties/priority-icon';
import { useFormatters } from '@/hooks/use-formatters';
import { useHotkeys } from '@/hooks/use-hotkeys';
import { useTranslations } from '@/hooks/use-translations';
import { getCycleDisplayName } from '@/lib/cycle-utils';
import { gql } from '@/lib/graphql';
import {
  ISSUE_SUBSCRIBE_MUTATION,
  ISSUE_SUBSCRIPTION_QUERY,
  ISSUE_UNSUBSCRIBE_MUTATION,
} from '@/lib/graphql-queries';
import { getDueDateColor } from '@/lib/issue-utils';
import { toast } from '@/lib/toast';
import { cn, TOUCH_TARGET } from '@/lib/utils';
import { useStore } from '@/providers/store-provider';
import type { IssueDetail, IssueLabel, IssueUser, WorkflowState } from '@/types/issues';
import { CustomFieldsEditor } from '../custom-fields/custom-fields-editor';
import { TipTapEditor } from '../editor/tiptap-editor.lazy';
import { AssigneeSelect } from '../properties/assignee-select';
import { CycleSelect } from '../properties/cycle-select';
import { DueDatePicker } from '../properties/due-date-picker';
import { EstimatePicker } from '../properties/estimate-picker';
import { LabelDot, LabelSelect } from '../properties/label-select';
import { PrioritySelect } from '../properties/priority-select';
import { ProjectSelect } from '../properties/project-select';
import { StatusSelect } from '../properties/status-select';
import { ActivityTimeline } from './activity-timeline';
import { AiInsights } from './ai-insights';
import { CommentThread } from './comment-thread';
import { FileAttachments } from './file-attachments';
import { IssueReactionBar } from './issue-reaction-bar';
import { PullRequestsSection } from './pull-requests-section';
import { RelationsSection } from './relations-section';
import { SubIssueList } from './sub-issue-list';

interface IssueDetailPanelProps {
  breadcrumb?: { label: string; onNavigate: () => void } | null;
  issue: IssueDetail | null;
  labels: IssueLabel[];
  onClose: () => void;
  onUpdate: (id: string, patch: Record<string, unknown>) => void;
  states: WorkflowState[];
  users: IssueUser[];
}

export const IssueDetailPanel = observer(function IssueDetailPanel({
  breadcrumb,
  issue,
  states,
  users,
  labels,
  onClose,
  onUpdate,
}: IssueDetailPanelProps) {
  const t = useTranslations();
  const { formatDueDate } = useFormatters();
  const { userStore, teamStore, issueStore, cycleStore } = useStore();
  const currentUserId = userStore.currentUser?.id;
  const currentUserName = userStore.currentUser?.displayName ?? t('issueDetail.defaultUserName');
  const mentionUsers = useMemo(() => users.map(u => ({ id: u.id, label: u.displayName })), [users]);
  // observer() tracks issueStore.all reads reactively; plain map is correct here.
  const mentionIssues = issueStore.all.map(i => ({ id: i.id, label: i.identifier, sub: i.title }));
  // Resolve estimation type from team so the correct scale displays
  const estimationType = teamStore.findById(issue?.teamId ?? '')?.issueEstimationType ?? 'notUsed';
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [editingDesc, setEditingDesc] = useState(false);
  const [descDraft, setDescDraft] = useState('');
  const [activityKey, setActivityKey] = useState(0);
  const titleRef = useRef<HTMLInputElement>(null);

  // Wrap onUpdate so any mutation triggers an activity re-fetch
  const handleUpdate = useCallback(
    (id: string, patch: Record<string, unknown>) => {
      onUpdate(id, patch);
      setActivityKey(k => k + 1);
    },
    [onUpdate],
  );

  // Subscription state: null = loading, true = subscribed, false = not subscribed
  const [subscribed, setSubscribed] = useState<boolean | null>(null);

  // Tracks the previously-rendered issue id so the effect below can tell an
  // actual issue switch apart from an in-place field update on the same
  // issue (e.g. a collaborator's edit arriving over WS).
  const prevIssueIdRef = useRef<string | null>(null);

  // Reset title/description drafts when switching issues, and refresh
  // whichever draft the user ISN'T actively editing when the same issue's
  // title/description changes underneath us (e.g. a collaborator's edit).
  // Two failure modes this balances:
  //  - Resetting on every render of the `issue` object (rebuilt on every
  //    pool change since callers pass a literal / observer() re-renders on
  //    any store change) would wipe in-progress typing on every unrelated
  //    property change — the original bug, fixed by keying off `issue?.id`.
  //  - But keying ONLY off `issue?.id` means a collaborator's incoming
  //    title/description change while the panel stays open on the same
  //    issue never refreshes the draft: clicking to edit later shows a
  //    stale value, and blurring can stomp the collaborator's change right
  //    back (`saveTitle`/`saveDesc` compare the stale draft against
  //    `issue.title`/`issue.description` and "helpfully" re-save it).
  // Switching issues (by id) always resets both drafts and collapses the
  // description editor, regardless of any in-flight edit for the issue
  // being left, so the collab provider remounts for the new document room.
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally excludes editingTitle/editingDesc — see comment above; only their freshest value at the moment id/title/description change matters, not a re-run when they toggle on their own
  useEffect(() => {
    if (!issue) {
      return;
    }
    const switchedIssue = prevIssueIdRef.current !== issue.id;
    prevIssueIdRef.current = issue.id;

    if (switchedIssue || !editingTitle) {
      setTitleDraft(issue.title);
    }
    if (switchedIssue) {
      // Collapse the description editor when switching issues so the collab
      // provider is remounted for the correct document room.
      setEditingDesc(false);
    }
    if (switchedIssue || !editingDesc) {
      setDescDraft(issue.description ?? '');
    }
  }, [issue?.id, issue?.title, issue?.description]);

  // Fetch subscription status when issue changes
  useEffect(() => {
    if (!issue?.id) {
      return;
    }
    setSubscribed(null);
    gql(ISSUE_SUBSCRIPTION_QUERY, { issueId: issue.id })
      .then(res => {
        if (res.errors?.length) {
          setSubscribed(false);
          return;
        }
        const val = res.data?.notificationIsSubscribed;
        setSubscribed(typeof val === 'boolean' ? val : false);
      })
      .catch(() => setSubscribed(false));
  }, [issue?.id]);

  const handleToggleSubscription = useCallback(async () => {
    if (!issue?.id || subscribed === null) {
      return;
    }
    const prev = subscribed;
    setSubscribed(!prev);
    try {
      const mutation = prev ? ISSUE_UNSUBSCRIBE_MUTATION : ISSUE_SUBSCRIBE_MUTATION;
      const res = await gql(mutation, { issueId: issue.id });
      if (res.errors?.length) {
        setSubscribed(prev);
        toast.error(
          prev ? t('issueDetail.failedToUnsubscribe') : t('issueDetail.failedToSubscribe'),
        );
      }
    } catch {
      setSubscribed(prev);
      toast.error(prev ? t('issueDetail.failedToUnsubscribe') : t('issueDetail.failedToSubscribe'));
    }
  }, [issue?.id, subscribed, t]);

  useHotkeys('shift+s', handleToggleSubscription, {}, [subscribed, issue?.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) {
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!issue) {
    return null;
  }

  const _state = states.find(s => s.id === issue.stateId);
  const assignee = users.find(u => u.id === issue.assigneeId);
  const dueDateColor = getDueDateColor(issue.dueDate);
  const currentCycle = issue.cycleId ? cycleStore.findById(issue.cycleId) : null;

  const saveTitle = () => {
    if (titleDraft.trim() && titleDraft.trim() !== issue.title) {
      handleUpdate(issue.id, { title: titleDraft.trim() });
    }
    setEditingTitle(false);
  };

  const saveDesc = () => {
    if (descDraft !== (issue.description ?? '')) {
      handleUpdate(issue.id, { description: descDraft || null });
    }
    setEditingDesc(false);
  };

  return (
    <>
      {/* Backdrop */}
      <div aria-hidden="true" className="fixed inset-0 z-30" onClick={onClose} />

      {/* Panel — full-screen sheet below md (no room for a side panel on a
          phone-width viewport); the fixed 480px side panel returns at md+. */}
      <div
        className="fixed inset-0 z-40 flex h-full w-full flex-col border-l border-border bg-card shadow-e3 md:inset-y-0 md:right-0 md:left-auto md:w-[480px]"
        data-testid="issue-detail-panel"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex min-w-0 items-center gap-1.5">
            {breadcrumb && (
              <>
                <button
                  className="flex items-center gap-1 truncate text-xs text-muted-foreground hover:text-foreground"
                  onClick={breadcrumb.onNavigate}
                  type="button"
                >
                  <ArrowLeft className="h-3 w-3 shrink-0" />
                  <span className="truncate">{breadcrumb.label}</span>
                </button>
                <span className="text-muted-foreground">/</span>
              </>
            )}
            <span className="font-mono text-xs text-muted-foreground">{issue.identifier}</span>
          </div>
          <div className="flex items-center gap-1">
            {subscribed !== null && (
              <button
                aria-label={
                  subscribed
                    ? t('issueDetail.unsubscribeShortcut')
                    : t('issueDetail.subscribeShortcut')
                }
                className={cn('rounded p-1 text-muted-foreground hover:bg-accent', TOUCH_TARGET)}
                onClick={handleToggleSubscription}
                title={
                  subscribed
                    ? t('issueDetail.unsubscribeShortcut')
                    : t('issueDetail.subscribeShortcut')
                }
                type="button"
              >
                {subscribed ? <BellOff className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
              </button>
            )}
            <button
              aria-label={t('common.close')}
              className={cn('rounded p-1 text-muted-foreground hover:bg-accent', TOUCH_TARGET)}
              onClick={onClose}
              type="button"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto p-5">
          {/* Title */}
          {editingTitle ? (
            <input
              className="w-full bg-transparent text-xl font-semibold tracking-tight text-foreground outline-none"
              onBlur={saveTitle}
              onChange={e => setTitleDraft(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  saveTitle();
                }
                if (e.key === 'Escape') {
                  setTitleDraft(issue.title);
                  setEditingTitle(false);
                }
              }}
              ref={titleRef}
              type="text"
              value={titleDraft}
            />
          ) : (
            <button
              className="cursor-text text-left text-xl font-semibold leading-snug tracking-tight text-foreground"
              onClick={() => {
                setEditingTitle(true);
                setTimeout(() => titleRef.current?.focus(), 20);
              }}
              type="button"
            >
              {issue.title}
            </button>
          )}

          {/* Properties grid */}
          <div className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            {/* Status */}
            <span className="text-muted-foreground">{t('issueDetail.properties.status')}</span>
            <StatusSelect
              onChange={stateId => handleUpdate(issue.id, { stateId })}
              states={states}
              value={issue.stateId}
            />

            {/* Priority */}
            <span className="text-muted-foreground">{t('issueDetail.properties.priority')}</span>
            <div className="flex items-center gap-1.5">
              <PrioritySelect
                onChange={priority => handleUpdate(issue.id, { priority })}
                value={issue.priority}
              />
              <span className="text-xs text-muted-foreground">
                {t(priorityLabelKey(issue.priority))}
              </span>
            </div>

            {/* Assignee */}
            <span className="text-muted-foreground">{t('issueDetail.properties.assignee')}</span>
            <div className="flex items-center gap-1.5">
              <AssigneeSelect
                onChange={assigneeId => handleUpdate(issue.id, { assigneeId })}
                users={users}
                value={issue.assigneeId}
              />
              <span className="text-xs text-muted-foreground">
                {assignee?.displayName ?? t('issueDetail.properties.noAssignee')}
              </span>
            </div>

            {/* Labels */}
            <span className="text-muted-foreground">{t('issueDetail.properties.labels')}</span>
            <div className="flex items-center gap-1 flex-wrap">
              <LabelSelect
                labels={labels}
                onChange={labelIds => handleUpdate(issue.id, { labelIds })}
                value={issue.labels.map(l => l.id)}
              />
              {issue.labels.map(l => (
                <span className="flex items-center gap-1 text-xs text-muted-foreground" key={l.id}>
                  <LabelDot color={l.color} />
                  {l.name}
                </span>
              ))}
            </div>

            {/* Project */}
            <span className="text-muted-foreground">{t('issueDetail.properties.project')}</span>
            <ProjectSelect
              onChange={projectId => handleUpdate(issue.id, { projectId })}
              value={issue.projectId ?? null}
            />

            {/* Cycle */}
            <span className="text-muted-foreground">{t('issueDetail.properties.cycle')}</span>
            <div className="flex items-center gap-1.5">
              <CycleSelect
                onChange={cycleId => handleUpdate(issue.id, { cycleId })}
                teamId={issue.teamId}
                value={issue.cycleId ?? null}
              />
              {currentCycle && (
                <span className="text-xs text-muted-foreground">
                  {getCycleDisplayName(currentCycle)}
                </span>
              )}
            </div>

            {/* Due date */}
            <span className="text-muted-foreground">{t('issueDetail.properties.dueDate')}</span>
            <div className="flex items-center gap-1.5">
              <DueDatePicker
                onChange={dueDate => handleUpdate(issue.id, { dueDate })}
                value={issue.dueDate}
              />
              {issue.dueDate && (
                <span className={cn('text-xs', dueDateColor)}>{formatDueDate(issue.dueDate)}</span>
              )}
            </div>

            {/* Estimate — only shown when the team uses estimation */}
            {estimationType !== 'notUsed' && (
              <>
                <span className="text-muted-foreground">
                  {t('issueDetail.properties.estimate')}
                </span>
                <EstimatePicker
                  estimationType={estimationType}
                  onChange={estimate => handleUpdate(issue.id, { estimate: estimate ?? undefined })}
                  value={issue.estimate}
                />
              </>
            )}
          </div>

          {/* Custom fields (per-team) */}
          <CustomFieldsEditor issueId={issue.id} teamId={issue.teamId} />

          {/* Description */}
          <div className="mt-6">
            <p className="mb-1 text-xs font-medium text-muted-foreground">
              {t('issueDetail.description')}
            </p>
            {editingDesc ? (
              <div className="rounded-md border border-brand bg-transparent p-2 transition-colors">
                <TipTapEditor
                  className="text-sm"
                  collabDocId={`issue:${issue.id}`}
                  collabUserName={currentUserName}
                  content={descDraft}
                  mentionIssues={mentionIssues}
                  mentionUsers={mentionUsers}
                  onBlur={saveDesc}
                  onChange={html => setDescDraft(html)}
                  placeholder={t('issueDetail.descriptionPlaceholderFull')}
                  readOnly={false}
                  showToolbar={true}
                  uploadIssueId={issue.id}
                />
              </div>
            ) : (
              <button
                className="w-full cursor-text rounded-md p-2 text-left transition-colors hover:bg-accent/50"
                onClick={() => setEditingDesc(true)}
                type="button"
              >
                <TipTapEditor
                  className="text-sm"
                  content={descDraft}
                  onBlur={saveDesc}
                  onChange={html => setDescDraft(html)}
                  placeholder={t('issueDetail.descriptionPlaceholder')}
                  readOnly={true}
                  showToolbar={false}
                />
              </button>
            )}
          </div>

          {/* Reactions */}
          <div className="mt-3">
            <IssueReactionBar currentUserId={currentUserId} issueId={issue.id} />
          </div>

          {/* AI insights */}
          <AiInsights issueId={issue.id} />

          {/* Sub-issues */}
          <SubIssueList parentIssueId={issue.id} />

          {/* Relations */}
          <RelationsSection issueId={issue.id} />

          {/* Pull Requests */}
          <PullRequestsSection issueId={issue.id} />

          {/* Attachments */}
          <FileAttachments issueId={issue.id} />

          {/* Comments */}
          <div className="mt-6">
            <p className="mb-3 text-xs font-medium text-muted-foreground">
              {t('issueDetail.comments.title')}
            </p>
            <CommentThread
              currentUserId={currentUserId}
              issueId={issue.id}
              mentionIssues={mentionIssues}
              mentionUsers={mentionUsers}
              teamId={issue.teamId}
            />
          </div>

          {/* Activity */}
          <div className="mt-6">
            <p className="mb-3 text-xs font-medium text-muted-foreground">
              {t('issueDetail.activity.title')}
            </p>
            <ActivityTimeline issueId={issue.id} refetchKey={activityKey} />
          </div>
        </div>
      </div>
    </>
  );
});
