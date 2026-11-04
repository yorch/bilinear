'use client';

import { observer } from 'mobx-react-lite';
import { priorityLabelKey } from '@/components/properties/priority-icon';
import { Input } from '@/components/ui/input';
import { SimpleSelect } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useTranslations } from '@/hooks/use-translations';
import { PRIORITY_OPTIONS } from '@/lib/issue-utils';
import { useStore } from '@/providers/store-provider';

/**
 * The structured replacement for the hand-written action-config JSON textarea.
 * Each action type the server understands (`automation.service.ts`
 * `ACTION_TYPES`) has exactly the fields its executor reads, so a rule can no
 * longer be saved with a config the executor would silently skip.
 */
export interface ActionDraft {
  assigneeId: string;
  body: string;
  labelId: string;
  priority: string;
  stateId: string;
}

export const EMPTY_ACTION_DRAFT: ActionDraft = {
  assigneeId: '',
  body: '',
  labelId: '',
  priority: '1',
  stateId: '',
};

/**
 * Turns the form draft into the `config` object the server stores, or `null`
 * when a required field is missing (or the action type is not one this form
 * knows how to build, so it can never submit a blind config).
 */
export function buildActionConfig(
  type: string,
  draft: ActionDraft,
): Record<string, unknown> | null {
  switch (type) {
    case 'set_priority': {
      // `Number('')` is 0, which is a valid priority — a blank must not become one.
      const priority = draft.priority.trim() === '' ? Number.NaN : Number(draft.priority);
      return Number.isInteger(priority) && priority >= 0 && priority <= 4 ? { priority } : null;
    }
    case 'set_state':
      return draft.stateId ? { stateId: draft.stateId } : null;
    case 'set_assignee':
      // An empty pick means "unassign", which the executor supports via null.
      return { assigneeId: draft.assigneeId || null };
    case 'add_label':
      return draft.labelId ? { labelId: draft.labelId } : null;
    case 'post_comment':
      return draft.body.trim() ? { body: draft.body.trim() } : null;
    default:
      return null;
  }
}

interface ActionFieldsProps {
  actionType: string;
  draft: ActionDraft;
  onChange: (next: ActionDraft) => void;
}

export const ActionFields = observer(function ActionFields({
  actionType,
  draft,
  onChange,
}: ActionFieldsProps) {
  const t = useTranslations();
  const { labelStore, organizationMemberStore, teamStore, userStore, workflowStateStore } =
    useStore();

  switch (actionType) {
    case 'set_priority':
      return (
        <SimpleSelect
          ariaLabel={t('settings.automations.fieldPriority')}
          onChange={priority => onChange({ ...draft, priority })}
          options={PRIORITY_OPTIONS.map(p => ({
            label: t(priorityLabelKey(Number(p.value))),
            value: p.value,
          }))}
          value={draft.priority}
        />
      );
    case 'set_state': {
      const teamKey = new Map(teamStore.all.map(team => [team.id, team.key]));
      return (
        <SimpleSelect
          ariaLabel={t('settings.automations.fieldState')}
          onChange={stateId => onChange({ ...draft, stateId })}
          options={workflowStateStore.all
            .filter(s => teamKey.has(s.teamId))
            .map(s => ({ label: `${teamKey.get(s.teamId)} · ${s.name}`, value: s.id }))}
          placeholder={t('settings.automations.chooseState')}
          value={draft.stateId}
        />
      );
    }
    case 'set_assignee': {
      const roles = organizationMemberStore.rolesByUserId as Record<string, unknown>;
      return (
        <SimpleSelect
          ariaLabel={t('settings.automations.fieldAssignee')}
          onChange={assigneeId => onChange({ ...draft, assigneeId })}
          options={[
            { label: t('settings.automations.unassigned'), value: '' },
            ...userStore.all
              .filter(u => roles[u.id] !== undefined)
              .map(u => ({ label: u.displayName || u.email, value: u.id })),
          ]}
          value={draft.assigneeId}
        />
      );
    }
    case 'add_label':
      return (
        <SimpleSelect
          ariaLabel={t('settings.automations.fieldLabel')}
          onChange={labelId => onChange({ ...draft, labelId })}
          options={labelStore.all
            .filter(l => !l.isGroup)
            .map(l => ({ label: l.name, value: l.id }))}
          placeholder={t('settings.automations.chooseLabel')}
          value={draft.labelId}
        />
      );
    case 'post_comment':
      return (
        <Textarea
          aria-label={t('settings.automations.fieldComment')}
          onChange={e => onChange({ ...draft, body: e.target.value })}
          placeholder={t('settings.automations.commentPlaceholder')}
          rows={3}
          value={draft.body}
        />
      );
    default:
      // A new server-side action type this build has no form for: say so
      // instead of offering a blank config.
      return (
        <Input
          aria-label={t('settings.automations.unsupportedAction')}
          disabled
          value={t('settings.automations.unsupportedAction')}
        />
      );
  }
});
