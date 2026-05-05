'use client';

import { useEffect, useState } from 'react';
import { gql } from '@/lib/graphql';
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
  const [webhooks, setWebhooks] = useState<Webhook[]>([]);
  const [availableEvents, setAvailableEvents] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [selectedEvents, setSelectedEvents] = useState<Set<string>>(new Set());
  const [revealedSecrets, setRevealedSecrets] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await gql(WEBHOOKS_QUERY);
      if (cancelled) {
        return;
      }
      if (res.errors?.length) {
        toast.error((res.errors[0] as { message?: string })?.message ?? 'Failed to load webhooks');
      } else {
        const data = (res.data ?? {}) as {
          webhooks?: Webhook[];
          webhookEvents?: string[];
        };
        setWebhooks(data.webhooks ?? []);
        setAvailableEvents(data.webhookEvents ?? []);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleCreate = async () => {
    if (!name.trim() || !url.trim() || selectedEvents.size === 0) {
      toast.error('Name, URL, and at least one event are required.');
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
      toast.error((res.errors[0] as { message?: string })?.message ?? 'Failed to create webhook');
      return;
    }
    const created = (res.data as { webhookCreate?: { webhook?: Webhook } } | undefined)
      ?.webhookCreate?.webhook;
    if (created) {
      setWebhooks(w => [created, ...w]);
      // Reveal secret once on create so the user can copy it.
      setRevealedSecrets(s => new Set(s).add(created.id));
      toast.success('Webhook created');
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
    if (!confirm(`Delete webhook "${hook.name}"?`)) {
      return;
    }
    const res = await gql(WEBHOOK_DELETE_MUTATION, { id: hook.id });
    if (!res.errors?.length) {
      setWebhooks(w => w.filter(h => h.id !== hook.id));
    }
  };

  const handleRotate = async (hook: Webhook) => {
    if (!confirm('Rotate the signing secret? Existing receivers will need the new value.')) {
      return;
    }
    const res = await gql(WEBHOOK_ROTATE_SECRET_MUTATION, { id: hook.id });
    if (!res.errors?.length) {
      const updated = (res.data as { webhookRotateSecret?: { webhook?: Webhook } } | undefined)
        ?.webhookRotateSecret?.webhook;
      if (updated) {
        setWebhooks(w =>
          w.map(h => (h.id === hook.id ? { ...h, signingSecret: updated.signingSecret } : h)),
        );
        setRevealedSecrets(s => new Set(s).add(hook.id));
        toast.success('Signing secret rotated');
      }
    }
  };

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-zinc-400">
        Loading...
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Webhooks</h1>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            Send events to external HTTP endpoints. Each delivery is signed with HMAC SHA-256
            (X-Bilinear-Signature header).
          </p>
        </div>
        <button
          className="rounded bg-indigo-600 px-3 py-1.5 text-xs text-white hover:bg-indigo-700"
          onClick={() => setCreating(c => !c)}
          type="button"
        >
          {creating ? 'Cancel' : '+ Add webhook'}
        </button>
      </div>

      {creating ? (
        <div className="mb-6 rounded border border-zinc-200 p-4 dark:border-zinc-800">
          <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="text-xs">
              <span className="mb-1 block text-zinc-700 dark:text-zinc-300">Name</span>
              <input
                className="w-full rounded border border-zinc-300 bg-transparent px-2 py-1 text-sm dark:border-zinc-700"
                onChange={e => setName(e.target.value)}
                placeholder="Production CI"
                value={name}
              />
            </label>
            <label className="text-xs">
              <span className="mb-1 block text-zinc-700 dark:text-zinc-300">URL</span>
              <input
                className="w-full rounded border border-zinc-300 bg-transparent px-2 py-1 text-sm dark:border-zinc-700"
                onChange={e => setUrl(e.target.value)}
                placeholder="https://example.com/hook"
                value={url}
              />
            </label>
          </div>
          <div className="mb-3">
            <span className="mb-1 block text-xs text-zinc-700 dark:text-zinc-300">Events</span>
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
            className="rounded bg-indigo-600 px-3 py-1.5 text-xs text-white hover:bg-indigo-700"
            onClick={handleCreate}
            type="button"
          >
            Create webhook
          </button>
        </div>
      ) : null}

      {webhooks.length === 0 ? (
        <div className="rounded border border-dashed border-zinc-300 px-4 py-8 text-center text-sm text-zinc-400 dark:border-zinc-700">
          No webhooks yet.
        </div>
      ) : (
        <div className="space-y-3">
          {webhooks.map(hook => (
            <div className="rounded border border-zinc-200 p-4 dark:border-zinc-800" key={hook.id}>
              <div className="flex items-start justify-between">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm text-zinc-900 dark:text-zinc-100">
                      {hook.name}
                    </span>
                    <span
                      className={`rounded px-1.5 py-0.5 text-xs ${
                        hook.enabled
                          ? 'bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300'
                          : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400'
                      }`}
                    >
                      {hook.enabled ? 'Enabled' : 'Disabled'}
                    </span>
                    {hook.consecutiveFailures > 0 ? (
                      <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-700 dark:bg-amber-950 dark:text-amber-300">
                        {hook.consecutiveFailures} consecutive failures
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-1 truncate font-mono text-xs text-zinc-500 dark:text-zinc-400">
                    {hook.url}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {hook.events.map(e => (
                      <span
                        className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-[10px] text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                        key={e}
                      >
                        {e}
                      </span>
                    ))}
                  </div>
                  <div className="mt-2 flex items-center gap-2 text-xs">
                    <span className="text-zinc-500 dark:text-zinc-400">Signing secret:</span>
                    {revealedSecrets.has(hook.id) ? (
                      <code className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs dark:bg-zinc-800">
                        {hook.signingSecret ?? '(hidden — non-admin)'}
                      </code>
                    ) : (
                      <button
                        className="text-indigo-600 hover:underline"
                        onClick={() =>
                          setRevealedSecrets(s => {
                            const next = new Set(s);
                            next.add(hook.id);
                            return next;
                          })
                        }
                        type="button"
                      >
                        Reveal
                      </button>
                    )}
                  </div>
                </div>
                <div className="flex flex-shrink-0 gap-1">
                  <button
                    className="rounded border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
                    onClick={() => handleToggle(hook)}
                    type="button"
                  >
                    {hook.enabled ? 'Disable' : 'Enable'}
                  </button>
                  <button
                    className="rounded border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
                    onClick={() => handleRotate(hook)}
                    type="button"
                  >
                    Rotate
                  </button>
                  <button
                    className="rounded border border-zinc-300 px-2 py-1 text-xs text-red-600 hover:bg-red-50 dark:border-zinc-700 dark:hover:bg-red-950/30"
                    onClick={() => handleDelete(hook)}
                    type="button"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
