'use client';

import { useCallback, useEffect, useState } from 'react';
import { useFormatters } from '@/hooks/use-formatters';
import { useTranslations } from '@/hooks/use-translations';
import { gql } from '@/lib/graphql';
import { toast } from '@/lib/toast';

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

export default function AutomationsSettingsPage() {
  const t = useTranslations();
  const { formatDateTime } = useFormatters();
  const [data, setData] = useState<RulesData | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  // Create-form state
  const [name, setName] = useState('');
  const [triggerType, setTriggerType] = useState('issue_created');
  const [actionType, setActionType] = useState('set_priority');
  const [actionConfigText, setActionConfigText] = useState('{"priority": 1}');

  const load = useCallback(async () => {
    setLoading(true);
    const res = await gql(RULES_QUERY, {});
    if (res.data) {
      setData(res.data as unknown as RulesData);
    } else {
      toast.error(t('settings.automations.loadError'));
    }
    setLoading(false);
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    let actionConfig: Record<string, unknown>;
    try {
      actionConfig = JSON.parse(actionConfigText);
    } catch {
      toast.error(t('settings.automations.invalidJsonError'));
      setCreating(false);
      return;
    }
    const res = await gql(RULE_CREATE_MUTATION, {
      input: {
        actions: [{ config: actionConfig, type: actionType }],
        enabled: true,
        name,
        triggerType,
      },
    });
    setCreating(false);
    if (res.errors?.length) {
      toast.error((res.errors[0] as { message: string }).message);
      return;
    }
    toast.success(t('settings.automations.ruleCreated'));
    setName('');
    setActionConfigText('{"priority": 1}');
    void load();
  };

  const handleToggle = async (rule: AutomationRule) => {
    const res = await gql(RULE_UPDATE_MUTATION, {
      id: rule.id,
      input: { enabled: !rule.enabled },
    });
    if (res.errors?.length) {
      toast.error((res.errors[0] as { message: string }).message);
      return;
    }
    void load();
  };

  const handleArchive = async (rule: AutomationRule) => {
    if (!confirm(t('settings.automations.deleteRuleConfirm', { name: rule.name }))) {
      return;
    }
    const res = await gql(RULE_ARCHIVE_MUTATION, { id: rule.id });
    if (res.errors?.length) {
      toast.error((res.errors[0] as { message: string }).message);
      return;
    }
    toast.success(t('settings.automations.ruleDeleted'));
    void load();
  };

  if (loading) {
    return <div className="p-6 text-sm text-muted-foreground">{t('common.loading')}</div>;
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-6">
      <h1 className="text-lg font-semibold text-foreground">{t('settings.automations.title')}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{t('settings.automations.description')}</p>

      <section className="mt-6 rounded-lg border border-border p-4">
        <h2 className="text-sm font-semibold text-foreground">
          {t('settings.automations.createRule')}
        </h2>
        <form className="mt-3 flex flex-col gap-3" onSubmit={handleCreate}>
          <input
            className="rounded-md border border-border px-2 py-1.5 text-sm dark:bg-background"
            onChange={e => setName(e.target.value)}
            placeholder={t('settings.automations.ruleNamePlaceholder')}
            required
            value={name}
          />
          <div className="flex gap-2">
            <select
              className="flex-1 rounded-md border border-border px-2 py-1.5 text-sm dark:bg-background"
              onChange={e => setTriggerType(e.target.value)}
              value={triggerType}
            >
              {data?.automationTriggerTypes.map(t => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <span className="self-center text-xs text-muted-foreground">
              {t('settings.automations.then')}
            </span>
            <select
              className="flex-1 rounded-md border border-border px-2 py-1.5 text-sm dark:bg-background"
              onChange={e => setActionType(e.target.value)}
              value={actionType}
            >
              {data?.automationActionTypes.map(t => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <textarea
            className="rounded-md border border-border px-2 py-1.5 font-mono text-xs dark:bg-background"
            onChange={e => setActionConfigText(e.target.value)}
            placeholder={t('settings.automations.actionConfigPlaceholder')}
            rows={3}
            value={actionConfigText}
          />
          <button
            className="self-start rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-primary/90 disabled:opacity-50"
            disabled={creating || !name}
            type="submit"
          >
            {creating
              ? t('settings.automations.creatingEllipsis')
              : t('settings.automations.createRule')}
          </button>
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
                className="flex items-center gap-3 rounded-md border border-border px-3 py-2.5"
                key={rule.id}
              >
                <button
                  aria-label={
                    rule.enabled
                      ? t('settings.automations.disableRule')
                      : t('settings.automations.enableRule')
                  }
                  className="text-xs"
                  onClick={() => handleToggle(rule)}
                  type="button"
                >
                  {rule.enabled ? '🟢' : '⚪️'}
                </button>
                <div className="flex-1">
                  <div className="text-sm font-medium text-foreground">{rule.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {t('settings.automations.when')}{' '}
                    <code className="font-mono">{rule.triggerType}</code> →{' '}
                    {rule.actions.map(a => (
                      <span className="font-mono" key={a.type}>
                        {a.type}
                      </span>
                    ))}
                    {' · '}
                    {t('settings.automations.runs', { count: rule.runCount })}
                    {rule.lastRunAt &&
                      ` · ${t('settings.automations.last', { date: formatDateTime(rule.lastRunAt) })}`}
                  </div>
                </div>
                <button
                  className="text-xs text-danger-subtle-foreground hover:text-danger-subtle-foreground"
                  onClick={() => handleArchive(rule)}
                  type="button"
                >
                  {t('common.delete')}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
