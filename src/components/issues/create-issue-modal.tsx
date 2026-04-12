'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { gql } from '@/lib/graphql';
import { cn } from '@/lib/utils';
import type { IssueLabel, IssueUser, WorkflowState } from '@/types/issues';
import { TipTapEditor } from '../editor/tiptap-editor';
import { AssigneeSelect } from '../properties/assignee-select';
import { DueDatePicker } from '../properties/due-date-picker';
import { LabelSelect } from '../properties/label-select';
import { PrioritySelect } from '../properties/priority-select';
import { StatusSelect } from '../properties/status-select';
import { TemplateSelector } from './template-selector';

const GET_TEMPLATES_QUERY = `
  query GetIssueTemplates($teamId: ID!) {
    issueTemplates(teamId: $teamId) { id name templateData isDefault }
  }
`;

interface CreateIssueInput {
  title: string;
  description?: string;
  stateId?: string;
  assigneeId?: string;
  priority: number;
  labelIds: string[];
  dueDate?: string | null;
}

interface CreateIssueModalProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (input: CreateIssueInput) => Promise<void>;
  states: WorkflowState[];
  users: IssueUser[];
  labels: IssueLabel[];
  defaultStateId?: string;
  teamId?: string;
}

export function CreateIssueModal({
  open,
  onClose,
  onSubmit,
  states,
  users,
  labels,
  defaultStateId,
  teamId,
}: CreateIssueModalProps) {
  const titleRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [stateId, setStateId] = useState(defaultStateId ?? states[0]?.id ?? '');
  const [assigneeId, setAssigneeId] = useState<string | null>(null);
  const [priority, setPriority] = useState(0);
  const [labelIds, setLabelIds] = useState<string[]>([]);
  const [dueDate, setDueDate] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);

  const applyTemplate = useCallback((data: object) => {
    const d = data as Record<string, unknown>;
    if (typeof d.title === 'string') {
      setTitle(d.title);
    }
    if (typeof d.description === 'string') {
      setDescription(d.description);
    }
    if (typeof d.priority === 'number') {
      setPriority(d.priority);
    }
    if (typeof d.stateId === 'string') {
      setStateId(d.stateId);
    }
    if (Array.isArray(d.labelIds)) {
      setLabelIds(d.labelIds as string[]);
    }
    if (typeof d.assigneeId === 'string') {
      setAssigneeId(d.assigneeId);
    }
  }, []);

  // When modal opens, reset fields; if teamId is provided, fetch and apply default template
  useEffect(() => {
    if (open) {
      setTitle('');
      setDescription('');
      setStateId(defaultStateId ?? states[0]?.id ?? '');
      setAssigneeId(null);
      setPriority(0);
      setLabelIds([]);
      setDueDate(null);
      setTemplateOpen(false);
      setTimeout(() => titleRef.current?.focus(), 50);

      if (teamId) {
        gql(GET_TEMPLATES_QUERY, { teamId })
          .then(res => {
            const templates = (
              res.data as {
                issueTemplates?: Array<{
                  id: string;
                  name: string;
                  templateData: object;
                  isDefault: boolean;
                }>;
              }
            )?.issueTemplates;
            const defaultTemplate = templates?.find(t => t.isDefault);
            if (defaultTemplate) {
              applyTemplate(defaultTemplate.templateData);
            }
          })
          .catch(() => {
            // Silently fail — template auto-apply is best-effort
          });
      }
    }
  }, [open, defaultStateId, states, teamId, applyTemplate]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
      // Alt+C — open template selector
      if (e.altKey && e.key === 'c') {
        e.preventDefault();
        setTemplateOpen(true);
      }
    };
    if (open) {
      window.addEventListener('keydown', onKey);
    }
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || submitting) {
      return;
    }

    setSubmitting(true);
    try {
      await onSubmit({
        assigneeId: assigneeId ?? undefined,
        description: description.trim() || undefined,
        dueDate,
        labelIds,
        priority,
        stateId: stateId || undefined,
        title: title.trim(),
      });
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) {
    return null;
  }

  return (
    <dialog
      open
      aria-label="Create issue"
      className="fixed inset-0 z-50 flex h-screen w-screen items-center justify-center bg-black/40 p-0 m-0 border-none max-w-none max-h-none"
      onClick={e => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
      onKeyDown={e => {
        if (e.key === 'Escape') {
          onClose();
        }
      }}
    >
      <div className="w-full max-w-lg rounded-xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-700 dark:bg-zinc-900">
        <form onSubmit={handleSubmit} className="flex flex-col">
          {/* Title */}
          <div className="px-5 pt-5">
            <input
              ref={titleRef}
              type="text"
              placeholder="Issue title"
              value={title}
              onChange={e => setTitle(e.target.value)}
              className="w-full bg-transparent text-lg font-medium text-zinc-900 placeholder-zinc-400 outline-none dark:text-zinc-100"
              required
            />
          </div>

          {/* Description */}
          <div className="px-5 pt-2">
            <TipTapEditor
              content={description}
              placeholder="Add description… (optional, supports **markdown**)"
              onChange={html => setDescription(html)}
              className="text-sm text-zinc-600 dark:text-zinc-400"
            />
          </div>

          {/* Properties toolbar */}
          <div className="flex flex-wrap items-center gap-1 border-t border-zinc-100 px-4 py-3 dark:border-zinc-800">
            <StatusSelect
              value={stateId}
              states={states}
              onChange={setStateId}
            />
            <PrioritySelect value={priority} onChange={setPriority} />
            <AssigneeSelect
              value={assigneeId}
              users={users}
              onChange={setAssigneeId}
            />
            <LabelSelect
              value={labelIds}
              labels={labels}
              onChange={setLabelIds}
            />
            <DueDatePicker value={dueDate} onChange={setDueDate} />
            {teamId && (
              <TemplateSelector
                teamId={teamId}
                onSelect={applyTemplate}
                forceOpen={templateOpen}
                onClose={() => setTemplateOpen(false)}
              />
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-2 border-t border-zinc-100 px-4 py-3 dark:border-zinc-800">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!title.trim() || submitting}
              className={cn(
                'rounded-md px-4 py-1.5 text-sm font-medium text-white transition-colors',
                'bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed',
              )}
            >
              {submitting ? 'Creating…' : 'Create issue'}
            </button>
          </div>
        </form>
      </div>
    </dialog>
  );
}
