'use client';

import { useState } from 'react';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { InlineRetry } from '@/components/shared/inline-retry';
import { PageSkeleton } from '@/components/ui/skeleton';
import { useDocumentTitle } from '@/hooks/use-document-title';
import { useRetryableFetch } from '@/hooks/use-retryable-fetch';
import { useTranslations } from '@/hooks/use-translations';
import { gql, gqlQuery } from '@/lib/graphql';
import { toast } from '@/lib/toast';

/**
 * Webhook management page (admins only).
 *
 * Webhooks aren't synced through the org-wide sync stream — only org admins
 * can manage them, so we fetch on demand via GraphQL queries instead of
 * mirroring the rows into MobX/Dexie.
 */

interface Webhook {
  consecutiveFailures: number;
  enabled: boolean;
  events: string[];
  id: string;
  lastDeliveryAt: string | null;
  lastSuccessAt: string | null;
  name: string;
  // Nullable: the field-level resolver returns null for non-admin
  // callers as defense-in-depth. This page is admin-gated so it'll
  // generally be a string, but treat it defensively.
  signingSecret: string | null;
  url: string;
}

const WEBHOOKS_QUERY = `
  query Webhooks {
    webhooks { id name url events enabled signingSecret lastDeliveryAt lastSuccessAt consecutiveFailures }
    webhookEvents
  }
`;

const WEBHOOK_CREATE_MUTATION = `
  mutation WebhookCreate($input: WebhookCreateInput!) {
    webhookCreate(input: $input) {
      success
      webhook { id name url events enabled signingSecret lastDeliveryAt lastSuccessAt consecutiveFailures }
    }
  }
`;

const WEBHOOK_DELETE_MUTATION = `
  mutation WebhookDelete($id: ID!) {
    webhookDelete(id: $id) { success }
  }
`;

const WEBHOOK_UPDATE_MUTATION = `
  mutation WebhookUpdate($id: ID!, $input: WebhookUpdateInput!) {
    webhookUpdate(id: $id, input: $input) {
      success
      webhook { id name url events enabled signingSecret consecutiveFailures }
    }
  }
`;

const WEBHOOK_ROTATE_SECRET_MUTATION = `
  mutation WebhookRotateSecret($id: ID!) {
    webhookRotateSecret(id: $id) {
      success
      webhook { id signingSecret }
    }
  }
`;

export default function WebhooksSettingsPage() {
  const t = useTranslations();
  useDocumentTitle(t('settings.webhooks.title'));
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [selectedEvents, setSelectedEvents] = useState<Set<string>>(new Set());
  const [revealedSecrets, setRevealedSecrets] = useState<Set<string>>(new Set());
  const [pendingAction, setPendingAction] = useState<{
    hook: Webhook;
    type: 'delete' | 'rotate';
  } | null>(null);

  // One query feeds both lists, so they travel together as one value.
  // gqlQuery throws on a GraphQL error, which makes the retry branch reachable —
  // previously a failed load toasted once and then rendered as "no webhooks".
  const {
    data: { availableEvents, webhooks },
    setData,
    loading,
    error,
    refetch: load,
  } = useRetryableFetch<{ availableEvents: string[]; webhooks: Webhook[] }>(
    async () => {
      const data = await gqlQuery<{ webhookEvents?: string[]; webhooks?: Webhook[] }>(
        WEBHOOKS_QUERY,
        {},
      );
      return { availableEvents: data.webhookEvents ?? [], webhooks: data.webhooks ?? [] };
    },
    [],
    { availableEvents: [], webhooks: [] },
  );

  const setWebhooks = (next: Webhook[] | ((prev: Webhook[]) => Webhook[])) => {
    setData(prev => ({
      ...prev,
      webhooks: typeof next === 'function' ? next(prev.webhooks) : next,
    }));
  };

  const handleCreate = async () => {
    if (!name.trim() || !url.trim() || selectedEvents.size === 0) {
      toast.error(t('settings.webhooks.createValidationError'));
      return;
    }
    const res = await gql(WEBHOOK_CREATE_MUTATION, {
      input: {
        events: Array.from(selectedEvents),
        name: name.trim(),
        url: url.trim(),
      },
    });
    if (res.errors?.length) {
      toast.error(
        (res.errors[0] as { message?: string })?.message ?? t('settings.webhooks.createError'),
      );
      return;
    }
    const created = (res.data as { webhookCreate?: { webhook?: Webhook } } | undefined)
      ?.webhookCreate?.webhook;
    if (created) {
      setWebhooks(w => [created, ...w]);
      // Reveal secret once on create so the user can copy it.
      setRevealedSecrets(s => new Set(s).add(created.id));
      toast.success(t('settings.webhooks.webhookCreated'));
    }
    setName('');
    setUrl('');
    setSelectedEvents(new Set());
    setCreating(false);
  };

  const handleToggle = async (hook: Webhook) => {
    const next = !hook.enabled;
    const res = await gql(WEBHOOK_UPDATE_MUTATION, {
      id: hook.id,
      input: { enabled: next },
    });
    if (!res.errors?.length) {
      setWebhooks(w =>
        w.map(h =>
          h.id === hook.id
            ? { ...h, enabled: next, ...(next ? { consecutiveFailures: 0 } : {}) }
            : h,
        ),
      );
    }
  };

  const handleDelete = async (hook: Webhook) => {
    const res = await gql(WEBHOOK_DELETE_MUTATION, { id: hook.id });
    if (!res.errors?.length) {
      setWebhooks(w => w.filter(h => h.id !== hook.id));
    }
  };

  const handleRotate = async (hook: Webhook) => {
    const res = await gql(WEBHOOK_ROTATE_SECRET_MUTATION, { id: hook.id });
    if (!res.errors?.length) {
      // The document selects only `{ id signingSecret }` — narrow the cast to
      // what is actually there rather than the full `Webhook` shape.
      const updated = (
        res.data as
          | { webhookRotateSecret?: { webhook?: Pick<Webhook, 'id' | 'signingSecret'> | null } }
          | undefined
      )?.webhookRotateSecret?.webhook;
      if (updated) {
        setWebhooks(w =>
          w.map(h => (h.id === hook.id ? { ...h, signingSecret: updated.signingSecret } : h)),
        );
        setRevealedSecrets(s => new Set(s).add(hook.id));
        toast.success(t('settings.webhooks.secretRotated'));
      }
    }
  };

  if (loading) {
    return <PageSkeleton />;
  }

  if (error) {
    return (
      <div className="mx-auto w-full max-w-3xl px-6 py-8">
        <InlineRetry message={t('settings.webhooks.loadError')} onRetry={() => load()} />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-foreground">{t('settings.webhooks.title')}</h1>
          <p className="mt-1 text-xs text-muted-foreground">{t('settings.webhooks.description')}</p>
        </div>
        <button
          className="rounded bg-primary px-3 py-1.5 text-xs text-primary-foreground hover:bg-primary/90"
          onClick={() => setCreating(c => !c)}
          type="button"
        >
          {creating ? t('common.cancel') : t('settings.webhooks.addWebhook')}
        </button>
      </div>

      {creating ? (
        <div className="mb-6 rounded border border-border p-4">
          <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="text-xs">
              <span className="mb-1 block text-foreground-secondary">
                {t('settings.webhooks.name')}
              </span>
              <input
                className="w-full rounded border border-border bg-transparent px-2 py-1 text-sm"
                onChange={e => setName(e.target.value)}
                placeholder={t('settings.webhooks.namePlaceholder')}
                value={name}
              />
            </label>
            <label className="text-xs">
              <span className="mb-1 block text-foreground-secondary">
                {t('settings.webhooks.url')}
              </span>
              <input
                className="w-full rounded border border-border bg-transparent px-2 py-1 text-sm"
                onChange={e => setUrl(e.target.value)}
                placeholder="https://example.com/hook"
                value={url}
              />
            </label>
          </div>
          <div className="mb-3">
            <span className="mb-1 block text-xs text-foreground-secondary">
              {t('settings.webhooks.events')}
            </span>
            <div className="grid grid-cols-2 gap-1 sm:grid-cols-3">
              {availableEvents.map(e => (
                <label className="flex items-center gap-1.5 text-xs" key={e}>
                  <input
                    checked={selectedEvents.has(e)}
                    onChange={() => {
                      setSelectedEvents(prev => {
                        const next = new Set(prev);
                        if (next.has(e)) {
                          next.delete(e);
                        } else {
                          next.add(e);
                        }
                        return next;
                      });
                    }}
                    type="checkbox"
                  />
                  <span className="font-mono">{e}</span>
                </label>
              ))}
            </div>
          </div>
          <button
            className="rounded bg-primary px-3 py-1.5 text-xs text-primary-foreground hover:bg-primary/90"
            onClick={handleCreate}
            type="button"
          >
            {t('settings.webhooks.createWebhook')}
          </button>
        </div>
      ) : null}

      {webhooks.length === 0 ? (
        <div className="rounded border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
          {t('settings.webhooks.noWebhooksYet')}
        </div>
      ) : (
        <div className="space-y-3">
          {webhooks.map(hook => (
            <div className="rounded border border-border p-4" key={hook.id}>
              <div className="flex items-start justify-between">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm text-foreground">{hook.name}</span>
                    <span
                      className={`rounded px-1.5 py-0.5 text-xs ${
                        hook.enabled
                          ? 'bg-success-subtle text-success-subtle-foreground'
                          : 'bg-muted text-muted-foreground'
                      }`}
                    >
                      {hook.enabled
                        ? t('settings.webhooks.enabled')
                        : t('settings.webhooks.disabled')}
                    </span>
                    {hook.consecutiveFailures > 0 ? (
                      <span className="rounded bg-warning-subtle px-1.5 py-0.5 text-xs text-warning-subtle-foreground">
                        {t('settings.webhooks.consecutiveFailures', {
                          count: hook.consecutiveFailures,
                        })}
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-1 truncate font-mono text-xs text-muted-foreground">
                    {hook.url}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {hook.events.map(e => (
                      <span
                        className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-foreground-secondary"
                        key={e}
                      >
                        {e}
                      </span>
                    ))}
                  </div>
                  <div className="mt-2 flex items-center gap-2 text-xs">
                    <span className="text-muted-foreground">
                      {t('settings.webhooks.signingSecret')}
                    </span>
                    {revealedSecrets.has(hook.id) ? (
                      <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                        {hook.signingSecret ?? t('settings.webhooks.hiddenNonAdmin')}
                      </code>
                    ) : (
                      <button
                        className="text-brand hover:underline"
                        onClick={() =>
                          setRevealedSecrets(s => {
                            const next = new Set(s);
                            next.add(hook.id);
                            return next;
                          })
                        }
                        type="button"
                      >
                        {t('settings.webhooks.reveal')}
                      </button>
                    )}
                  </div>
                </div>
                <div className="flex flex-shrink-0 gap-1">
                  <button
                    className="rounded border border-border px-2 py-1 text-xs hover:bg-muted"
                    onClick={() => handleToggle(hook)}
                    type="button"
                  >
                    {hook.enabled ? t('settings.webhooks.disable') : t('settings.webhooks.enable')}
                  </button>
                  <button
                    className="rounded border border-border px-2 py-1 text-xs hover:bg-muted"
                    onClick={() => setPendingAction({ hook, type: 'rotate' })}
                    type="button"
                  >
                    {t('settings.webhooks.rotate')}
                  </button>
                  <button
                    className="rounded border border-border px-2 py-1 text-xs text-danger-subtle-foreground hover:bg-danger-subtle"
                    onClick={() => setPendingAction({ hook, type: 'delete' })}
                    type="button"
                  >
                    {t('common.delete')}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      <ConfirmDialog
        confirmLabel={
          pendingAction?.type === 'rotate' ? t('settings.webhooks.rotate') : t('common.delete')
        }
        message={
          pendingAction?.type === 'rotate'
            ? t('settings.webhooks.rotateConfirm')
            : t('settings.webhooks.deleteConfirm', { name: pendingAction?.hook.name ?? '' })
        }
        onCancel={() => setPendingAction(null)}
        onConfirm={() => {
          if (pendingAction?.type === 'rotate') {
            void handleRotate(pendingAction.hook);
          } else if (pendingAction?.type === 'delete') {
            void handleDelete(pendingAction.hook);
          }
          setPendingAction(null);
        }}
        open={pendingAction !== null}
        title={
          pendingAction?.type === 'rotate' ? t('settings.webhooks.rotate') : t('common.delete')
        }
      />
    </div>
  );
}
