'use client';

import { useEffect, useRef, useState } from 'react';
import {
  formatDueDate,
  getDueDateColor,
  getPriorityConfig,
} from '@/lib/issue-utils';
import { cn } from '@/lib/utils';
import type { IssueLabel, IssueUser, WorkflowState } from '@/types/issues';
import { TipTapEditor } from '../editor/tiptap-editor';
import { AssigneeSelect } from '../properties/assignee-select';
import { DueDatePicker } from '../properties/due-date-picker';
import { LabelDot, LabelSelect } from '../properties/label-select';
import { PrioritySelect } from '../properties/priority-select';
import { StatusSelect } from '../properties/status-select';
import { ActivityTimeline } from './activity-timeline';
import { CommentThread } from './comment-thread';

interface IssueDetail {
  id: string;
  identifier: string;
  title: string;
  description?: string | null;
  priority: number;
  stateId: string;
  assigneeId?: string | null;
  dueDate?: string | null;
  labels: IssueLabel[];
  createdAt: string;
  updatedAt: string;
}

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
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [editingDesc, setEditingDesc] = useState(false);
  const [descDraft, setDescDraft] = useState('');
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (issue) {
      setTitleDraft(issue.title);
      setDescDraft(issue.description ?? '');
    }
  }, [issue]);

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
      onUpdate(issue.id, { title: titleDraft.trim() });
    }
    setEditingTitle(false);
  };

  const saveDesc = () => {
    if (descDraft !== (issue.description ?? '')) {
      onUpdate(issue.id, { description: descDraft || null });
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
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            aria-label="Close"
          >
            ✕
          </button>
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
              onChange={stateId => onUpdate(issue.id, { stateId })}
            />

            {/* Priority */}
            <span className="text-zinc-500">Priority</span>
            <div className="flex items-center gap-1.5">
              <PrioritySelect
                value={issue.priority}
                onChange={priority => onUpdate(issue.id, { priority })}
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
                onChange={assigneeId => onUpdate(issue.id, { assigneeId })}
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
                onChange={labelIds => onUpdate(issue.id, { labelIds })}
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
                onChange={dueDate => onUpdate(issue.id, { dueDate })}
              />
              {issue.dueDate && (
                <span className={cn('text-xs', dueDateColor)}>
                  {formatDueDate(issue.dueDate)}
                </span>
              )}
            </div>
          </div>

          {/* Description */}
          <div className="mt-6">
            <p className="mb-1 text-xs font-medium text-zinc-500">
              Description
            </p>
            {editingDesc ? (
              <div className="rounded-md border border-indigo-400 bg-transparent p-2 transition-colors">
                <TipTapEditor
                  content={descDraft}
                  placeholder="Add a description… (supports **markdown**, /slash commands)"
                  onChange={html => setDescDraft(html)}
                  onBlur={saveDesc}
                  readOnly={false}
                  showToolbar={true}
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
                  placeholder="Add a description… (supports **markdown**, /slash commands)"
                  onChange={html => setDescDraft(html)}
                  onBlur={saveDesc}
                  readOnly={true}
                  showToolbar={false}
                  className="text-sm"
                />
              </button>
            )}
          </div>

          {/* Comments */}
          <div className="mt-6">
            <p className="mb-3 text-xs font-medium text-zinc-500">Comments</p>
            <CommentThread issueId={issue.id} />
          </div>

          {/* Activity */}
          <div className="mt-6">
            <p className="mb-3 text-xs font-medium text-zinc-500">Activity</p>
            <ActivityTimeline issueId={issue.id} />
          </div>
        </div>
      </div>
    </>
  );
}
