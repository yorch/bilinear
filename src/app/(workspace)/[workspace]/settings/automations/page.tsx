'use client';

import { observer } from 'mobx-react-lite';
import { useState } from 'react';
import {
  type ActionDraft,
  ActionFields,
  buildActionConfig,
  EMPTY_ACTION_DRAFT,
} from '@/components/settings/automation-action-fields';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { LoadError } from '@/components/shared/load-error';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { SimpleSelect } from '@/components/ui/select';
import { RowsSkeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { useDocumentTitle } from '@/hooks/use-document-title';
import { useFormatters } from '@/hooks/use-formatters';
import { useRetryableFetch } from '@/hooks/use-retryable-fetch';
import { useTranslations } from '@/hooks/use-translations';
import { GqlError, gqlMutate } from '@/lib/graphql';
import { toast } from '@/lib/toast';
import { getErrorMessage } from '@/lib/utils';

interface AutomationRule {
  actions: Array<{ config: Record<string, unknown>; type: string }>;
  conditions: Record<string, unknown> | null;
  description: string | null;
  enabled: boolean;
  id: string;
  lastRunAt: string | null;
  name: string;
  runCount: number;
  triggerConfig: Record<string, unknown>;
  triggerType: string;
}

const RULES_QUERY = `
  query AutomationRules {
    automationRules {
      id name description triggerType triggerConfig conditions actions enabled lastRunAt runCount
    }
    automationTriggerTypes
    automationActionTypes
  }
`;

const RULE_CREATE_MUTATION = `
  mutation AutomationRuleCreate($input: AutomationRuleCreateInput!) {
    automationRuleCreate(input: $input) {
      success
      rule { id name description triggerType triggerConfig conditions actions enabled lastRunAt runCount }
    }
  }
`;

const RULE_UPDATE_MUTATION = `
  mutation AutomationRuleUpdate($id: ID!, $input: AutomationRuleUpdateInput!) {
    automationRuleUpdate(id: $id, input: $input) {
      success
      rule { id name description triggerType triggerConfig conditions actions enabled lastRunAt runCount }
    }
  }
`;

const RULE_ARCHIVE_MUTATION = `
  mutation AutomationRuleArchive($id: ID!) {
    automationRuleArchive(id: $id) { success }
  }
`;

interface RulesData {
  automationActionTypes: string[];
  automationRules: AutomationRule[];
  automationTriggerTypes: string[];
}

/**
 * `gql()` hands back an untyped `data` bag, so the shape is checked rather than
 * asserted: a server-side rename previously compiled clean, typechecked clean,
 * and then threw when the page mapped over an undefined array. A response that
 * does not match takes the same error path as a failed request.
 */
function isRulesData(value: unknown): value is RulesData {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const v = value as Record<string, unknown>;
  const isStringArray = (x: unknown) => Array.isArray(x) && x.every(s => typeof s === 'string');
  return (
    isStringArray(v.automationActionTypes) &&
    isStringArray(v.automationTriggerTypes) &&
    Array.isArray(v.automationRules) &&
    v.automationRules.every(isAutomationRule)
  );
}

/**
 * Element-level check for the rule list. `Array.isArray` alone would let
 * `[1, 2, 'x']` through and then hand it to the renderer as `AutomationRule[]`,
 * which is the exact class of runtime failure the guard exists to stop.
 */
function isAutomationRule(value: unknown): value is AutomationRule {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const r = value as Record<string, unknown>;
  return (
    typeof r.id === 'string' &&
    typeof r.name === 'string' &&
    typeof r.triggerType === 'string' &&
    typeof r.enabled === 'boolean' &&
    Array.isArray(r.actions)
  );
}

const TRIGGER_LABEL_KEYS: Record<string, string> = {
  comment_created: 'settings.automations.triggers.comment_created',
  issue_assignee_changed: 'settings.automations.triggers.issue_assignee_changed',
  issue_created: 'settings.automations.triggers.issue_created',
  issue_priority_changed: 'settings.automations.triggers.issue_priority_changed',
  issue_state_changed: 'settings.automations.triggers.issue_state_changed',
};

const ACTION_LABEL_KEYS: Record<string, string> = {
  add_label: 'settings.automations.actions.add_label',
  post_comment: 'settings.automations.actions.post_comment',
  set_assignee: 'settings.automations.actions.set_assignee',
  set_priority: 'settings.automations.actions.set_priority',
  set_state: 'settings.automations.actions.set_state',
};

const AutomationsSettingsPage = observer(function AutomationsSettingsPage() {
  const t = useTranslations();
  useDocumentTitle(t('settings.automations.title'));
  const { formatDateTime } = useFormatters();
  const [creating, setCreating] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<AutomationRule | null>(null);

  // Create-form state
  const [name, setName] = useState('');
  const [triggerType, setTriggerType] = useState('issue_created');
  const [actionType, setActionType] = useState('set_priority');
  const [draft, setDraft] = useState<ActionDraft>(EMPTY_ACTION_DRAFT);
  const triggerLabel = (id: string) => (TRIGGER_LABEL_KEYS[id] ? t(TRIGGER_LABEL_KEYS[id]) : id);
  const actionLabel = (id: string) => (ACTION_LABEL_KEYS[id] ? t(ACTION_LABEL_KEYS[id]) : id);

  // The fetcher throws on a shape mismatch so `error` below covers both a failed
  // request and a response that isn't RulesData — the page used to toast and then
  // render as though the list were simply empty.
  const {
    data,
    loading,
    error,
    cause,
    refetch: load,
  } = useRetryableFetch<RulesData | null>(
    async () => {
      // gqlMutate throws a coded GqlError, so a non-admin's FORBIDDEN reaches
      // `LoadError` as a refusal rather than a retryable failure.
      const data = await gqlMutate(RULES_QUERY, {});
      if (!isRulesData(data)) {
        throw new Error('Unexpected automationRules response shape');
      }
      return data;
    },
    [],
    null,
  );

  const actionConfig = buildActionConfig(actionType, draft);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!actionConfig) {
      return;
    }
    setCreating(true);
    try {
      await gqlMutate(RULE_CREATE_MUTATION, {
        input: {
          actions: [{ config: actionConfig, type: actionType }],
          enabled: true,
          name: name.trim(),
          triggerType,
        },
      });
      toast.success(t('settings.automations.ruleCreated'));
      setName('');
      setDraft(EMPTY_ACTION_DRAFT);
      void load();
    } catch (err) {
      toast.error(getErrorMessage(err, t('settings.automations.createError')));
    } finally {
      setCreating(false);
    }
  };

  const handleToggle = async (rule: AutomationRule) => {
    try {
      await gqlMutate(RULE_UPDATE_MUTATION, { id: rule.id, input: { enabled: !rule.enabled } });
      void load();
    } catch (err) {
      toast.error(getErrorMessage(err, t('settings.automations.updateError')));
    }
  };

  const handleArchive = async (rule: AutomationRule) => {
    try {
      await gqlMutate(RULE_ARCHIVE_MUTATION, { id: rule.id });
      toast.success(t('settings.automations.ruleDeleted'));
      void load();
    } catch (err) {
      toast.error(getErrorMessage(err, t('settings.automations.deleteError')));
    }
  };

  if (loading) {
    return <RowsSkeleton className="p-6" count={5} />;
  }

  if (error || !data) {
    return (
      <div className="flex flex-1 flex-col overflow-y-auto">
        <PageHeader
          description={t('settings.automations.description')}
          title={t('settings.automations.title')}
        />
        <div className="mx-auto w-full max-w-4xl px-4 py-6 md:px-6">
          <LoadError
            cause={cause instanceof GqlError ? cause : undefined}
            fallback={t('settings.automations.loadError')}
            forbiddenMessage={t('settings.automations.forbidden')}
            onRetry={() => load()}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      <PageHeader
        description={t('settings.automations.description')}
        title={t('settings.automations.title')}
      />
      <div className="mx-auto w-full max-w-4xl px-4 py-6 md:px-6">
        <section className="rounded-lg border border-border bg-card p-4">
          <h2 className="text-sm font-semibold text-foreground">
            {t('settings.automations.createRule')}
          </h2>
          <form className="mt-3 flex flex-col gap-3" onSubmit={handleCreate}>
            <div>
              <label className="mb-1 block text-xs text-foreground-secondary" htmlFor="rule-name">
                {t('settings.automations.ruleName')}
              </label>
              <Input
                id="rule-name"
                onChange={e => setName(e.target.value)}
                placeholder={t('settings.automations.ruleNamePlaceholder')}
                required
                value={name}
              />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <span className="mb-1 block text-xs text-foreground-secondary">
                  {t('settings.automations.when')}
                </span>
                <SimpleSelect
                  ariaLabel={t('settings.automations.when')}
                  onChange={setTriggerType}
                  options={(data?.automationTriggerTypes ?? []).map(id => ({
                    label: triggerLabel(id),
                    value: id,
                  }))}
                  value={triggerType}
                />
              </div>
              <div>
                <span className="mb-1 block text-xs text-foreground-secondary">
                  {t('settings.automations.then')}
                </span>
                <SimpleSelect
                  ariaLabel={t('settings.automations.then')}
                  onChange={value => {
                    setActionType(value);
                    setDraft(EMPTY_ACTION_DRAFT);
                  }}
                  options={(data?.automationActionTypes ?? []).map(id => ({
                    label: actionLabel(id),
                    value: id,
                  }))}
                  value={actionType}
                />
              </div>
            </div>
            <ActionFields actionType={actionType} draft={draft} onChange={setDraft} />
            <Button
              className="self-start"
              disabled={creating || !name.trim() || !actionConfig}
              size="sm"
              type="submit"
            >
              {creating
                ? t('settings.automations.creatingEllipsis')
                : t('settings.automations.createRule')}
            </Button>
          </form>
        </section>

        <section className="mt-6">
          <h2 className="mb-3 text-sm font-semibold text-foreground">
            {t('settings.automations.rulesCount', { count: data?.automationRules.length ?? 0 })}
          </h2>
          {data?.automationRules.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('settings.automations.noRulesYet')}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {data?.automationRules.map(rule => (
                <li
                  className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2.5"
                  key={rule.id}
                >
                  <Switch
                    aria-label={
                      rule.enabled
                        ? t('settings.automations.disableRule')
                        : t('settings.automations.enableRule')
                    }
                    checked={rule.enabled}
                    onCheckedChange={() => void handleToggle(rule)}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-foreground">{rule.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {t('settings.automations.when')}{' '}
                      <span className="text-foreground-secondary">
                        {triggerLabel(rule.triggerType)}
                      </span>{' '}
                      →{' '}
                      {rule.actions.map(a => (
                        <span className="text-foreground-secondary" key={a.type}>
                          {actionLabel(a.type)}
                        </span>
                      ))}
                      {' · '}
                      {t('settings.automations.runs', { count: rule.runCount })}
                      {rule.lastRunAt &&
                        ` · ${t('settings.automations.last', { date: formatDateTime(rule.lastRunAt) })}`}
                    </div>
                  </div>
                  <Button
                    className="shrink-0 text-danger-subtle-foreground"
                    onClick={() => setPendingDelete(rule)}
                    size="xs"
                    type="button"
                    variant="ghost"
                  >
                    {t('common.delete')}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <ConfirmDialog
          message={t('settings.automations.deleteRuleConfirm', { name: pendingDelete?.name ?? '' })}
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => {
            if (pendingDelete) {
              void handleArchive(pendingDelete);
            }
            setPendingDelete(null);
          }}
          open={pendingDelete !== null}
          title={t('common.delete')}
        />
      </div>
    </div>
  );
});

export default AutomationsSettingsPage;
