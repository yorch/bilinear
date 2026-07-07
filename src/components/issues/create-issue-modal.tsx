'use client';

import { Users } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
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
import { Button } from '../ui/button';
import { ModalDialog } from '../ui/modal-dialog';
import { SelectPopover } from '../ui/select-popover';
import { Switch } from '../ui/switch';
import { TemplateSelector } from './template-selector';

export interface CreateIssueTeamOption {
  icon?: string | null;
  id: string;
  key: string;
  name: string;
}

const CREATE_MORE_STORAGE_KEY = 'bilinear:create-issue:create-more';

function loadCreateMore(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  return window.localStorage.getItem(CREATE_MORE_STORAGE_KEY) === '1';
}

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
  /** Called when the user switches teams via the in-modal picker (only rendered when `teams` has 2+ entries). */
  onTeamChange?: (teamId: string) => void;
  open: boolean;
  states: WorkflowState[];
  teamId?: string;
  /** All teams the picker can switch between. Omit (or a single-team list) to hide the picker. */
  teams?: CreateIssueTeamOption[];
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
  teams,
  onTeamChange,
}: CreateIssueModalProps) {
  const t = useTranslations();
  const titleRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState<FormState>(() => initialForm(defaultStateId, states[0]?.id));
  const [submitting, setSubmitting] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [aiAvailable, setAiAvailable] = useState(false);
  const [suggestingTitle, setSuggestingTitle] = useState(false);
  const [createMore, setCreateMore] = useState(loadCreateMore);
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  // Synchronous re-entry guard. The disabled prop on the submit button
  // races React's state-update commit, so a fast double click (notably
  // under Firefox + Playwright) can dispatch two handleSubmit runs before
  // setSubmitting(true) ever lands and create the issue twice.
  const submittingRef = useRef(false);
  // Tracks the previous (open, teamId) pair so the reset effect below can
  // tell "just opened" apart from "team switched while already open".
  const prevOpenTeamRef = useRef<{ open: boolean; teamId: string | undefined }>({
    open: false,
    teamId,
  });

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

  // Reset form state when the modal opens, and reset just stateId when the
  // team changes via the in-modal picker while already open (the previously-
  // selected stateId almost certainly doesn't belong to the new team's
  // states). Keyed on (open, teamId) rather than the MobX-derived
  // states/defaultStateId props directly — those get fresh array/value
  // identities on every unrelated re-render, and including them in the dep
  // array would wipe in-progress typing (`disabled={!title.trim()}` then
  // stays true), producing flaky e2e behaviour under Firefox + Playwright.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only re-run on open/team transitions
  useEffect(() => {
    const prev = prevOpenTeamRef.current;
    prevOpenTeamRef.current = { open, teamId };
    if (!open) {
      return;
    }

    if (!prev.open) {
      // Freshly opened — full reset.
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
      return;
    }

    if (prev.teamId !== teamId) {
      // Already open, team switched via the picker — just the stateId needs resetting.
      patchForm({ stateId: defaultStateId ?? states[0]?.id ?? '' });
    }
  }, [open, teamId]);

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
      if (createMore) {
        toast.success(t('issueDetail.createModal.issueCreated'));
        setForm(initialForm(defaultStateId, states[0]?.id));
        setTemplateOpen(false);
        titleRef.current?.focus();
      } else {
        onClose();
      }
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  // Bare-minimum text content, stripped of TipTap's HTML wrapper — an empty
  // editor still emits '<p></p>', which would otherwise read as dirty.
  const descriptionText = form.description.replace(/<[^>]+>/g, '').trim();
  const isDirty =
    form.title.trim() !== '' ||
    descriptionText !== '' ||
    form.assigneeId !== null ||
    form.dueDate !== null ||
    form.labelIds.length > 0 ||
    form.priority !== 0 ||
    form.projectId !== null;

  const requestClose = () => {
    if (isDirty) {
      setConfirmingDiscard(true);
    } else {
      onClose();
    }
  };

  const handleCreateMoreChange = (checked: boolean) => {
    setCreateMore(checked);
    window.localStorage.setItem(CREATE_MORE_STORAGE_KEY, checked ? '1' : '0');
  };

  return (
    <ModalDialog
      aria-label={t('issueDetail.createModal.createIssue')}
      maxWidth="lg"
      onClose={requestClose}
      open={open}
    >
      <form className="flex flex-col" onSubmit={handleSubmit}>
        {/* Title */}
        <div className="flex items-center gap-2 px-5 pt-5">
          <input
            className="w-full bg-transparent text-lg font-medium text-foreground placeholder:text-muted-foreground outline-none"
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
                'shrink-0 rounded-md border border-border px-2 py-1 text-xs font-medium',
                'text-indigo-600 hover:bg-indigo-50 disabled:opacity-50',
                'border-border dark:text-indigo-400 dark:hover:bg-indigo-950/30',
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
            className="text-sm text-muted-foreground"
            content={form.description}
            onChange={html => patchForm({ description: html })}
            placeholder={t('issueDetail.createModal.descriptionPlaceholder')}
          />
        </div>

        {/* Properties toolbar */}
        <div className="flex flex-wrap items-center gap-1 border-t border-border px-4 py-3">
          {teams && teams.length > 1 && onTeamChange && (
            <SelectPopover
              panelClassName="w-56 py-1"
              triggerChildren={
                <>
                  <Users className="h-3.5 w-3.5" />
                  {teams.find(team => team.id === teamId)?.key ?? teams[0]?.key}
                </>
              }
              triggerClassName="gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent"
              triggerTitle={t('issueDetail.createModal.team')}
            >
              {close => (
                <>
                  {teams.map(team => (
                    <button
                      className={cn(
                        'flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-accent',
                        team.id === teamId && 'font-medium text-primary',
                      )}
                      key={team.id}
                      onClick={() => {
                        onTeamChange(team.id);
                        close();
                      }}
                      type="button"
                    >
                      {team.icon ? (
                        <span className="text-xs">{team.icon}</span>
                      ) : (
                        <Users className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      )}
                      <span className="truncate">{team.name}</span>
                    </button>
                  ))}
                </>
              )}
            </SelectPopover>
          )}
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
        <div className="flex items-center justify-between gap-2 border-t border-border px-4 py-3">
          <span className="flex items-center gap-2 text-sm text-muted-foreground">
            <Switch
              aria-label={t('issueDetail.createModal.createMore')}
              checked={createMore}
              onCheckedChange={handleCreateMoreChange}
            />
            {t('issueDetail.createModal.createMore')}
          </span>
          <div className="flex items-center gap-2">
            <Button onClick={requestClose} size="sm" type="button" variant="ghost">
              {t('common.cancel')}
            </Button>
            <Button disabled={!form.title.trim() || submitting} size="sm" type="submit">
              {submitting
                ? t('issueDetail.createModal.creating')
                : t('issueDetail.createModal.createIssue')}
            </Button>
          </div>
        </div>
      </form>
      <ConfirmDialog
        confirmLabel={t('issueDetail.createModal.discard')}
        message={t('issueDetail.createModal.discardConfirmBody')}
        onCancel={() => setConfirmingDiscard(false)}
        onConfirm={() => {
          setConfirmingDiscard(false);
          onClose();
        }}
        open={confirmingDiscard}
        title={t('issueDetail.createModal.discardConfirmTitle')}
      />
    </ModalDialog>
  );
}
