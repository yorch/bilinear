'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from '@/hooks/use-translations';
import { gql } from '@/lib/graphql';
import { ISSUE_TEMPLATES_QUERY } from '@/lib/graphql-queries';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';
import type { IssueLabel, IssueUser, WorkflowState } from '@/types/issues';
import { TipTapEditor } from '../editor/tiptap-editor.lazy';
import { AssigneeSelect } from '../properties/assignee-select';
import { DueDatePicker } from '../properties/due-date-picker';
import { LabelSelect } from '../properties/label-select';
import { PrioritySelect } from '../properties/priority-select';
import { ProjectSelect } from '../properties/project-select';
import { StatusSelect } from '../properties/status-select';
import { ModalDialog } from '../ui/modal-dialog';
import { TemplateSelector } from './template-selector';

interface FormState {
  assigneeId: string | null;
  description: string;
  dueDate: string | null;
  labelIds: string[];
  priority: number;
  projectId: string | null;
  stateId: string;
  title: string;
}

function initialForm(defaultStateId?: string, firstStateId?: string): FormState {
  return {
    assigneeId: null,
    description: '',
    dueDate: null,
    labelIds: [],
    priority: 0,
    projectId: null,
    stateId: defaultStateId ?? firstStateId ?? '',
    title: '',
  };
}

export interface CreateIssueInput {
  assigneeId?: string;
  description?: string;
  dueDate?: string | null;
  labelIds: string[];
  priority: number;
  projectId?: string;
  stateId?: string;
  title: string;
}

interface CreateIssueModalProps {
  defaultStateId?: string;
  labels: IssueLabel[];
  onClose: () => void;
  onSubmit: (input: CreateIssueInput) => Promise<void>;
  open: boolean;
  states: WorkflowState[];
  teamId?: string;
  users: IssueUser[];
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
  const t = useTranslations();
  const titleRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState<FormState>(() => initialForm(defaultStateId, states[0]?.id));
  const [submitting, setSubmitting] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [aiAvailable, setAiAvailable] = useState(false);
  const [suggestingTitle, setSuggestingTitle] = useState(false);
  // Synchronous re-entry guard. The disabled prop on the submit button
  // races React's state-update commit, so a fast double click (notably
  // under Firefox + Playwright) can dispatch two handleSubmit runs before
  // setSubmitting(true) ever lands and create the issue twice.
  const submittingRef = useRef(false);

  const patchForm = useCallback(
    (patch: Partial<FormState>) => setForm(prev => ({ ...prev, ...patch })),
    [],
  );

  const applyTemplate = useCallback(
    (data: object) => {
      const d = data as Record<string, unknown>;
      const patch: Partial<FormState> = {};
      if (typeof d.assigneeId === 'string') {
        patch.assigneeId = d.assigneeId;
      }
      if (typeof d.description === 'string') {
        patch.description = d.description;
      }
      if (Array.isArray(d.labelIds)) {
        patch.labelIds = d.labelIds as string[];
      }
      if (typeof d.priority === 'number') {
        patch.priority = d.priority;
      }
      if (typeof d.stateId === 'string') {
        patch.stateId = d.stateId;
      }
      if (typeof d.title === 'string') {
        patch.title = d.title;
      }
      patchForm(patch);
    },
    [patchForm],
  );

  // Reset form state only when the modal transitions from closed to open.
  // Including the MobX-derived props (states, defaultStateId, teamId) in the
  // dep array re-runs this effect every render — `setTitle('')` mid-typing
  // wipes user input and `disabled={!title.trim()}` keeps the submit button
  // disabled, producing flaky e2e behaviour under Firefox + Playwright.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only re-run on open transitions
  useEffect(() => {
    if (!open) {
      return;
    }
    setForm(initialForm(defaultStateId, states[0]?.id));
    setTemplateOpen(false);
    setTimeout(() => titleRef.current?.focus(), 50);

    // Probe AI availability once per open so the "Suggest" affordance only
    // shows when the workspace has AI enabled and a key is configured.
    gql('query AiAvailable { aiAvailable }')
      .then(res => setAiAvailable(Boolean((res.data as { aiAvailable?: boolean })?.aiAvailable)))
      .catch(() => setAiAvailable(false));

    if (teamId) {
      gql(ISSUE_TEMPLATES_QUERY, { teamId })
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
  }, [open]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
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
  }, [open]);

  const handleSuggestTitle = async () => {
    // Strip TipTap HTML to plain text for a cleaner prompt.
    const text = form.description
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!text) {
      toast.error(t('issueDetail.createModal.addDescriptionFirst'));
      return;
    }
    setSuggestingTitle(true);
    try {
      const res = await gql(
        'mutation AiSuggestIssueTitle($description: String!) { aiSuggestIssueTitle(description: $description) { title } }',
        { description: text },
      );
      const title = (res.data as { aiSuggestIssueTitle?: { title?: string } })?.aiSuggestIssueTitle
        ?.title;
      if (title) {
        patchForm({ title });
      }
    } catch {
      toast.error(t('issueDetail.createModal.couldNotSuggestTitle'));
    } finally {
      setSuggestingTitle(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim() || submittingRef.current) {
      return;
    }

    submittingRef.current = true;
    setSubmitting(true);
    try {
      await onSubmit({
        assigneeId: form.assigneeId ?? undefined,
        description: form.description.trim() || undefined,
        dueDate: form.dueDate,
        labelIds: form.labelIds,
        priority: form.priority,
        projectId: form.projectId ?? undefined,
        stateId: form.stateId || undefined,
        title: form.title.trim(),
      });
      onClose();
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  return (
    <ModalDialog
      aria-label={t('issueDetail.createModal.createIssue')}
      maxWidth="lg"
      onClose={onClose}
      open={open}
    >
      <form className="flex flex-col" onSubmit={handleSubmit}>
        {/* Title */}
        <div className="flex items-center gap-2 px-5 pt-5">
          <input
            className="w-full bg-transparent text-lg font-medium text-zinc-900 placeholder-zinc-400 outline-none dark:text-zinc-100"
            onChange={e => patchForm({ title: e.target.value })}
            placeholder={t('issueDetail.createModal.titlePlaceholder')}
            ref={titleRef}
            required
            type="text"
            value={form.title}
          />
          {aiAvailable && (
            <button
              className={cn(
                'shrink-0 rounded-md border border-zinc-200 px-2 py-1 text-xs font-medium',
                'text-indigo-600 hover:bg-indigo-50 disabled:opacity-50',
                'dark:border-zinc-700 dark:text-indigo-400 dark:hover:bg-indigo-950/30',
              )}
              disabled={suggestingTitle}
              onClick={handleSuggestTitle}
              title={t('issueDetail.createModal.suggestTitleFromDescription')}
              type="button"
            >
              {suggestingTitle ? '…' : `✨ ${t('issueDetail.createModal.suggest')}`}
            </button>
          )}
        </div>

        {/* Description */}
        <div className="px-5 pt-2">
          <TipTapEditor
            className="text-sm text-zinc-600 dark:text-zinc-400"
            content={form.description}
            onChange={html => patchForm({ description: html })}
            placeholder={t('issueDetail.createModal.descriptionPlaceholder')}
          />
        </div>

        {/* Properties toolbar */}
        <div className="flex flex-wrap items-center gap-1 border-t border-zinc-100 px-4 py-3 dark:border-zinc-800">
          <StatusSelect
            onChange={v => patchForm({ stateId: v })}
            states={states}
            value={form.stateId}
          />
          <PrioritySelect onChange={v => patchForm({ priority: v })} value={form.priority} />
          <AssigneeSelect
            onChange={v => patchForm({ assigneeId: v })}
            users={users}
            value={form.assigneeId}
          />
          <LabelSelect
            labels={labels}
            onChange={v => patchForm({ labelIds: v })}
            value={form.labelIds}
          />
          <DueDatePicker onChange={v => patchForm({ dueDate: v })} value={form.dueDate} />
          <ProjectSelect onChange={v => patchForm({ projectId: v })} value={form.projectId} />
          {teamId && (
            <TemplateSelector
              forceOpen={templateOpen}
              onClose={() => setTemplateOpen(false)}
              onSelect={applyTemplate}
              teamId={teamId}
            />
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-2 border-t border-zinc-100 px-4 py-3 dark:border-zinc-800">
          <button
            className="rounded-md px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
            onClick={onClose}
            type="button"
          >
            {t('common.cancel')}
          </button>
          <button
            className={cn(
              'rounded-md px-4 py-1.5 text-sm font-medium text-white transition-colors',
              'bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed',
            )}
            disabled={!form.title.trim() || submitting}
            type="submit"
          >
            {submitting
              ? t('issueDetail.createModal.creating')
              : t('issueDetail.createModal.createIssue')}
          </button>
        </div>
      </form>
    </ModalDialog>
  );
}
