'use client';

import { Bell, BellOff } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useHotkeys } from '@/hooks/use-hotkeys';
import { gql } from '@/lib/graphql';
import {
  formatDueDate,
  getDueDateColor,
  getPriorityConfig,
} from '@/lib/issue-utils';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';
import { useStore } from '@/providers/store-provider';
import type {
  IssueDetail,
  IssueLabel,
  IssueUser,
  WorkflowState,
} from '@/types/issues';
import { CustomFieldsEditor } from '../custom-fields/custom-fields-editor';
import { TipTapEditor } from '../editor/tiptap-editor';
import { AssigneeSelect } from '../properties/assignee-select';
import { DueDatePicker } from '../properties/due-date-picker';
import { EstimatePicker } from '../properties/estimate-picker';
import { LabelDot, LabelSelect } from '../properties/label-select';
import { PrioritySelect } from '../properties/priority-select';
import { StatusSelect } from '../properties/status-select';
import { ActivityTimeline } from './activity-timeline';
import { CommentThread } from './comment-thread';
import { RelationsSection } from './relations-section';
import { SubIssueList } from './sub-issue-list';

// ---------------------------------------------------------------------------
// GraphQL strings
// ---------------------------------------------------------------------------

const CHECK_SUBSCRIPTION_QUERY = `
  query NotificationIsSubscribed($issueId: ID!) {
    notificationIsSubscribed(issueId: $issueId)
  }
`;

const SUBSCRIBE_MUTATION = `
  mutation NotificationSubscribe($issueId: ID!) {
    notificationSubscribe(issueId: $issueId) { success lastSyncId }
  }
`;

const UNSUBSCRIBE_MUTATION = `
  mutation NotificationUnsubscribe($issueId: ID!) {
    notificationUnsubscribe(issueId: $issueId) { success lastSyncId }
  }
`;

interface IssueDetailPanelProps {
  issue: IssueDetail | null;
  states: WorkflowState[];
  users: IssueUser[];
  labels: IssueLabel[];
  onClose: () => void;
  onUpdate: (id: string, patch: Record<string, unknown>) => void;
}

export function IssueDetailPanel({
  issue,
  states,
  users,
  labels,
  onClose,
  onUpdate,
}: IssueDetailPanelProps) {
  const { userStore, teamStore } = useStore();
  const currentUserId = userStore.currentUser?.id;
  const mentionUsers = useMemo(
    () => users.map(u => ({ id: u.id, label: u.displayName })),
    [users],
  );
  // Resolve estimation type from team so the correct scale displays
  const estimationType =
    teamStore.findById(issue?.teamId ?? '')?.issueEstimationType ?? 'notUsed';
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

  useEffect(() => {
    if (issue) {
      setTitleDraft(issue.title);
      setDescDraft(issue.description ?? '');
    }
  }, [issue]);

  // Fetch subscription status when issue changes
  useEffect(() => {
    if (!issue?.id) {
      return;
    }
    setSubscribed(null);
    gql(CHECK_SUBSCRIPTION_QUERY, { issueId: issue.id })
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
      const mutation = prev ? UNSUBSCRIBE_MUTATION : SUBSCRIBE_MUTATION;
      const res = await gql(mutation, { issueId: issue.id });
      if (res.errors?.length) {
        setSubscribed(prev);
        toast.error(prev ? 'Failed to unsubscribe' : 'Failed to subscribe');
      }
    } catch {
      setSubscribed(prev);
      toast.error(prev ? 'Failed to unsubscribe' : 'Failed to subscribe');
    }
  }, [issue?.id, subscribed]);

  useHotkeys('shift+s', handleToggleSubscription, {}, [subscribed, issue?.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
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
  const priorityConfig = getPriorityConfig(issue.priority);
  const dueDateColor = getDueDateColor(issue.dueDate);

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
      <div
        className="fixed inset-0 z-30"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Panel */}
      <div
        data-testid="issue-detail-panel"
        className="fixed right-0 top-0 z-40 flex h-full w-[480px] flex-col border-l border-zinc-200 bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-700">
          <span className="font-mono text-xs text-zinc-400">
            {issue.identifier}
          </span>
          <div className="flex items-center gap-1">
            {subscribed !== null && (
              <button
                type="button"
                onClick={handleToggleSubscription}
                className="rounded p-1 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                aria-label={
                  subscribed ? 'Unsubscribe (Shift+S)' : 'Subscribe (Shift+S)'
                }
                title={
                  subscribed ? 'Unsubscribe (Shift+S)' : 'Subscribe (Shift+S)'
                }
              >
                {subscribed ? (
                  <BellOff className="h-4 w-4" />
                ) : (
                  <Bell className="h-4 w-4" />
                )}
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="rounded p-1 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              aria-label="Close"
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
              ref={titleRef}
              type="text"
              value={titleDraft}
              onChange={e => setTitleDraft(e.target.value)}
              onBlur={saveTitle}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  saveTitle();
                }
                if (e.key === 'Escape') {
                  setTitleDraft(issue.title);
                  setEditingTitle(false);
                }
              }}
              className="w-full bg-transparent text-xl font-semibold outline-none"
            />
          ) : (
            <button
              type="button"
              className="cursor-text text-left text-xl font-semibold text-zinc-900 dark:text-zinc-100"
              onClick={() => {
                setEditingTitle(true);
                setTimeout(() => titleRef.current?.focus(), 20);
              }}
            >
              {issue.title}
            </button>
          )}

          {/* Properties grid */}
          <div className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            {/* Status */}
            <span className="text-zinc-500">Status</span>
            <StatusSelect
              value={issue.stateId}
              states={states}
              onChange={stateId => handleUpdate(issue.id, { stateId })}
            />

            {/* Priority */}
            <span className="text-zinc-500">Priority</span>
            <div className="flex items-center gap-1.5">
              <PrioritySelect
                value={issue.priority}
                onChange={priority => handleUpdate(issue.id, { priority })}
              />
              <span className="text-xs text-zinc-600">
                {priorityConfig.label}
              </span>
            </div>

            {/* Assignee */}
            <span className="text-zinc-500">Assignee</span>
            <div className="flex items-center gap-1.5">
              <AssigneeSelect
                value={issue.assigneeId}
                users={users}
                onChange={assigneeId => handleUpdate(issue.id, { assigneeId })}
              />
              <span className="text-xs text-zinc-600">
                {assignee?.displayName ?? 'No assignee'}
              </span>
            </div>

            {/* Labels */}
            <span className="text-zinc-500">Labels</span>
            <div className="flex items-center gap-1 flex-wrap">
              <LabelSelect
                value={issue.labels.map(l => l.id)}
                labels={labels}
                onChange={labelIds => handleUpdate(issue.id, { labelIds })}
              />
              {issue.labels.map(l => (
                <span
                  key={l.id}
                  className="flex items-center gap-1 text-xs text-zinc-600"
                >
                  <LabelDot color={l.color} />
                  {l.name}
                </span>
              ))}
            </div>

            {/* Due date */}
            <span className="text-zinc-500">Due date</span>
            <div className="flex items-center gap-1.5">
              <DueDatePicker
                value={issue.dueDate}
                onChange={dueDate => handleUpdate(issue.id, { dueDate })}
              />
              {issue.dueDate && (
                <span className={cn('text-xs', dueDateColor)}>
                  {formatDueDate(issue.dueDate)}
                </span>
              )}
            </div>

            {/* Estimate — only shown when the team uses estimation */}
            {estimationType !== 'notUsed' && (
              <>
                <span className="text-zinc-500">Estimate</span>
                <EstimatePicker
                  value={issue.estimate}
                  estimationType={estimationType}
                  onChange={estimate =>
                    handleUpdate(issue.id, { estimate: estimate ?? undefined })
                  }
                />
              </>
            )}
          </div>

          {/* Custom fields (per-team) */}
          <CustomFieldsEditor issueId={issue.id} teamId={issue.teamId} />

          {/* Description */}
          <div className="mt-6">
            <p className="mb-1 text-xs font-medium text-zinc-500">
              Description
            </p>
            {editingDesc ? (
              <div className="rounded-md border border-indigo-400 bg-transparent p-2 transition-colors">
                <TipTapEditor
                  content={descDraft}
                  placeholder="Add a description… (supports **markdown**, /slash commands, @mentions)"
                  onChange={html => setDescDraft(html)}
                  onBlur={saveDesc}
                  readOnly={false}
                  showToolbar={true}
                  mentionUsers={mentionUsers}
                  className="text-sm"
                />
              </div>
            ) : (
              <button
                type="button"
                className="w-full cursor-text rounded-md p-2 text-left transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
                onClick={() => setEditingDesc(true)}
              >
                <TipTapEditor
                  content={descDraft}
                  placeholder="Add a description… (supports **markdown**, /slash commands, @mentions)"
                  onChange={html => setDescDraft(html)}
                  onBlur={saveDesc}
                  readOnly={true}
                  showToolbar={false}
                  className="text-sm"
                />
              </button>
            )}
          </div>

          {/* Sub-issues */}
          <SubIssueList parentIssueId={issue.id} />

          {/* Relations */}
          <RelationsSection issueId={issue.id} />

          {/* Comments */}
          <div className="mt-6">
            <p className="mb-3 text-xs font-medium text-zinc-500">Comments</p>
            <CommentThread
              issueId={issue.id}
              teamId={issue.teamId}
              currentUserId={currentUserId}
              mentionUsers={mentionUsers}
            />
          </div>

          {/* Activity */}
          <div className="mt-6">
            <p className="mb-3 text-xs font-medium text-zinc-500">Activity</p>
            <ActivityTimeline issueId={issue.id} refetchKey={activityKey} />
          </div>
        </div>
      </div>
    </>
  );
}
