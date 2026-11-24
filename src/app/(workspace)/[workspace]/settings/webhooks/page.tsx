'use client';

import { ChevronDown, Copy } from 'lucide-react';
import { useState } from 'react';
import { WebhookForm, type WebhookFormValues } from '@/components/settings/webhook-form';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { LoadError } from '@/components/shared/load-error';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { ModalDialog } from '@/components/ui/modal-dialog';
import { PageHeader } from '@/components/ui/page-header';
import { PageSkeleton, RowsSkeleton } from '@/components/ui/skeleton';
import { useDocumentTitle } from '@/hooks/use-document-title';
import { useFormatters } from '@/hooks/use-formatters';
import { useRetryableFetch } from '@/hooks/use-retryable-fetch';
import { useTranslations } from '@/hooks/use-translations';
import { gql, gqlQuery, isPermissionError } from '@/lib/graphql';
import { toast } from '@/lib/toast';
import { cn, TOUCH_TARGET } from '@/lib/utils';
import { deliveryTone } from '@/lib/webhook-delivery';

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

interface WebhookDelivery {
  attempts: number;
  createdAt: string;
  errorMessage: string | null;
  event: string;
  id: string;
  responseStatus: number | null;
  status: string;
}

const WEBHOOKS_QUERY = `
  query Webhooks {
    webhooks { id name url events enabled signingSecret lastDeliveryAt lastSuccessAt consecutiveFailures }
    webhookEvents
  }
`;

const WEBHOOK_DELIVERIES_QUERY = `
  query WebhookDeliveries($webhookId: ID!, $limit: Int) {
    webhookDeliveries(webhookId: $webhookId, limit: $limit) {
      id event status attempts responseStatus errorMessage createdAt
    }
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

const WEBHOOK_TEST_MUTATION = `
  mutation WebhookTest($id: ID!) {
    webhookTest(id: $id) {
      success
      delivery { id status responseStatus errorMessage attempts }
    }
  }
`;

interface WebhookTestResult {
  attempts: number;
  errorMessage: string | null;
  id: string;
  responseStatus: number | null;
  status: string;
}

const WEBHOOK_ROTATE_SECRET_MUTATION = `
  mutation WebhookRotateSecret($id: ID!) {
    webhookRotateSecret(id: $id) {
      success
      webhook { id signingSecret }
    }
  }
`;

const DELIVERIES_LIMIT = 20;

/**
 * The last few deliveries for one webhook. Mounted only while expanded, so
 * the fetch runs on open and the list is fresh each time — a failing hook is
 * usually being watched while its endpoint is fixed.
 */
function WebhookDeliveries({ webhookId }: { webhookId: string }) {
  const t = useTranslations();
  const { formatDateTime } = useFormatters();
  const {
    data: deliveries,
    loading,
    error,
    cause,
    refetch,
  } = useRetryableFetch<WebhookDelivery[]>(
    async () =>
      (await gqlQuery<WebhookDelivery[] | null>(
        WEBHOOK_DELIVERIES_QUERY,
        { limit: DELIVERIES_LIMIT, webhookId },
        'webhookDeliveries',
      )) ?? [],
    [webhookId],
    [],
  );

  if (loading) {
    return <RowsSkeleton className="py-2" count={3} />;
  }
  if (error) {
    return (
      <LoadError
        cause={cause}
        fallback={t('settings.webhooks.deliveries.loadError')}
        onRetry={() => refetch()}
      />
    );
  }
  if (deliveries.length === 0) {
    return <EmptyState size="compact" title={t('settings.webhooks.deliveries.empty')} />;
  }

  return (
    <div className="overflow-x-auto rounded border border-border">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border bg-muted text-left font-medium text-muted-foreground">
            <th className="px-3 py-1.5">{t('settings.webhooks.deliveries.colStatus')}</th>
            <th className="px-3 py-1.5">{t('settings.webhooks.deliveries.colEvent')}</th>
            <th className="px-3 py-1.5 text-right">
              {t('settings.webhooks.deliveries.colAttempts')}
            </th>
            <th className="px-3 py-1.5">{t('settings.webhooks.deliveries.colError')}</th>
            <th className="px-3 py-1.5">{t('settings.webhooks.deliveries.colTime')}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {deliveries.map(d => (
            <tr className="bg-background" key={d.id}>
              <td className="px-3 py-1.5">
                <Badge className="font-mono" tone={deliveryTone(d.status)} variant="square">
                  {d.status}
                  {d.responseStatus !== null ? ` · ${d.responseStatus}` : ''}
                </Badge>
              </td>
              <td className="px-3 py-1.5 font-mono text-foreground-secondary">{d.event}</td>
              <td className="px-3 py-1.5 text-right font-mono tabular-nums text-muted-foreground">
                {d.attempts}
              </td>
              <td
                className="max-w-xs truncate px-3 py-1.5 text-muted-foreground"
                title={d.errorMessage ?? undefined}
              >
                {d.errorMessage ?? '—'}
              </td>
              <td className="whitespace-nowrap px-3 py-1.5 font-mono tabular-nums text-muted-foreground">
                {formatDateTime(d.createdAt, {
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                  month: 'short',
                })}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function WebhooksSettingsPage() {
  const t = useTranslations();
  useDocumentTitle(t('settings.webhooks.title'));
  const [creating, setCreating] = useState(false);
  const [creatingBusy, setCreatingBusy] = useState(false);
  const [editing, setEditing] = useState<Webhook | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, WebhookTestResult>>({});
  // Bumped after a test so an open deliveries list refetches and shows the ping.
  const [deliveriesVersion, setDeliveriesVersion] = useState(0);
  const [revealedSecrets, setRevealedSecrets] = useState<Set<string>>(new Set());
  const [expandedDeliveries, setExpandedDeliveries] = useState<Set<string>>(new Set());
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
    cause,
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

  // A non-admin's FORBIDDEN is not a failure: this route is reachable from the
  // settings nav, so being turned away is an expected answer with nothing to
  // retry. `LoadError` renders it muted; this flag only hides the create
  // control, which would otherwise offer an action the server will refuse.
  const forbidden = isPermissionError(cause);

  const setWebhooks = (next: Webhook[] | ((prev: Webhook[]) => Webhook[])) => {
    setData(prev => ({
      ...prev,
      webhooks: typeof next === 'function' ? next(prev.webhooks) : next,
    }));
  };

  const toggleDeliveries = (id: string) => {
    setExpandedDeliveries(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleCreate = async (values: WebhookFormValues) => {
    setCreatingBusy(true);
    try {
      const res = await gql(WEBHOOK_CREATE_MUTATION, { input: values });
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
      setCreating(false);
    } catch {
      toast.error(t('settings.webhooks.createError'));
    } finally {
      setCreatingBusy(false);
    }
  };

  const handleEdit = async (hook: Webhook, values: WebhookFormValues) => {
    setCreatingBusy(true);
    try {
      const res = await gql(WEBHOOK_UPDATE_MUTATION, { id: hook.id, input: values });
      if (res.errors?.length) {
        toast.error(
          (res.errors[0] as { message?: string })?.message ?? t('settings.webhooks.updateError'),
        );
        return;
      }
      const updated = (res.data as { webhookUpdate?: { webhook?: Webhook | null } } | undefined)
        ?.webhookUpdate?.webhook;
      if (updated) {
        setWebhooks(w => w.map(h => (h.id === hook.id ? { ...h, ...updated } : h)));
      }
      setEditing(null);
      toast.success(t('settings.webhooks.webhookUpdated'));
    } catch {
      toast.error(t('settings.webhooks.updateError'));
    } finally {
      setCreatingBusy(false);
    }
  };

  const handleTest = async (hook: Webhook) => {
    setTestingId(hook.id);
    try {
      const res = await gql(WEBHOOK_TEST_MUTATION, { id: hook.id });
      if (res.errors?.length) {
        toast.error(
          (res.errors[0] as { message?: string })?.message ?? t('settings.webhooks.testError'),
        );
        return;
      }
      const delivery = (res.data as { webhookTest?: { delivery?: WebhookTestResult } } | undefined)
        ?.webhookTest?.delivery;
      if (delivery) {
        setTestResults(r => ({ ...r, [hook.id]: delivery }));
        setDeliveriesVersion(v => v + 1);
        if (delivery.status === 'success') {
          toast.success(
            t('settings.webhooks.testSucceeded', { status: delivery.responseStatus ?? '' }),
          );
        } else {
          toast.error(t('settings.webhooks.testFailed'));
        }
      }
    } catch {
      toast.error(t('settings.webhooks.testError'));
    } finally {
      setTestingId(null);
    }
  };

  const handleToggle = async (hook: Webhook) => {
    const next = !hook.enabled;
    try {
      const res = await gql(WEBHOOK_UPDATE_MUTATION, {
        id: hook.id,
        input: { enabled: next },
      });
      if (res.errors?.length) {
        toast.error(t('settings.webhooks.updateError'));
        return;
      }
      setWebhooks(w =>
        w.map(h =>
          h.id === hook.id
            ? { ...h, enabled: next, ...(next ? { consecutiveFailures: 0 } : {}) }
            : h,
        ),
      );
      toast.success(
        next ? t('settings.webhooks.webhookEnabled') : t('settings.webhooks.webhookDisabled'),
      );
    } catch {
      toast.error(t('settings.webhooks.updateError'));
    }
  };

  const handleDelete = async (hook: Webhook) => {
    try {
      const res = await gql(WEBHOOK_DELETE_MUTATION, { id: hook.id });
      if (res.errors?.length) {
        toast.error(t('settings.webhooks.deleteError'));
        return;
      }
      setWebhooks(w => w.filter(h => h.id !== hook.id));
      toast.success(t('settings.webhooks.webhookDeleted'));
    } catch {
      toast.error(t('settings.webhooks.deleteError'));
    }
  };

  const handleRotate = async (hook: Webhook) => {
    try {
      const res = await gql(WEBHOOK_ROTATE_SECRET_MUTATION, { id: hook.id });
      if (res.errors?.length) {
        toast.error(t('settings.webhooks.rotateError'));
        return;
      }
      // The document selects only `{ id signingSecret }` — narrow the cast to
      // what is actually there rather than the full `Webhook` shape.
      const updated = (
        res.data as
          | { webhookRotateSecret?: { webhook?: Pick<Webhook, 'id' | 'signingSecret'> | null } }
          | undefined
      )?.webhookRotateSecret?.webhook;
      if (!updated) {
        toast.error(t('settings.webhooks.rotateError'));
        return;
      }
      setWebhooks(w =>
        w.map(h => (h.id === hook.id ? { ...h, signingSecret: updated.signingSecret } : h)),
      );
      setRevealedSecrets(s => new Set(s).add(hook.id));
      toast.success(t('settings.webhooks.secretRotated'));
    } catch {
      toast.error(t('settings.webhooks.rotateError'));
    }
  };

  const copySecret = (secret: string) => {
    void navigator.clipboard.writeText(secret);
    toast.success(t('settings.webhooks.secretCopied'));
  };

  if (loading) {
    return <PageSkeleton />;
  }

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      <PageHeader
        actions={
          !forbidden && (
            <Button
              onClick={() => setCreating(c => !c)}
              size="sm"
              type="button"
              variant={creating ? 'outline' : 'default'}
            >
              {creating ? t('common.cancel') : t('settings.webhooks.addWebhook')}
            </Button>
          )
        }
        description={t('settings.webhooks.description')}
        title={t('settings.webhooks.title')}
      />

      <div className="mx-auto w-full max-w-3xl px-4 py-6 md:px-6 md:py-8">
        {/* Rendered inside the page shell, not instead of it: replacing the whole
            page drops the heading and reads as a crash rather than a failed
            section. A refused read renders as a muted line with no retry. */}
        {error && (
          // Localized copy, not the server's raw text — see the audit-log page.
          <LoadError
            cause={cause}
            fallback={t('settings.webhooks.loadError')}
            forbiddenMessage={t('settings.webhooks.forbidden')}
            onRetry={() => load()}
          />
        )}

        {creating ? (
          <div className="mb-6 rounded-lg border border-border bg-card p-4">
            <WebhookForm
              availableEvents={availableEvents}
              busy={creatingBusy}
              onSubmit={values => void handleCreate(values)}
            />
          </div>
        ) : null}

        {/* A failed read renders no list at all: an unreadable set of hooks must
            never be mistaken for "none yet". */}
        {error ? null : webhooks.length === 0 ? (
          <EmptyState size="compact" title={t('settings.webhooks.noWebhooksYet')} />
        ) : (
          <div className="space-y-3">
            {webhooks.map(hook => {
              const showDeliveries = expandedDeliveries.has(hook.id);
              return (
                <div className="rounded-lg border border-border bg-card p-4" key={hook.id}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-foreground">{hook.name}</span>
                        <Badge tone={hook.enabled ? 'success' : 'muted'} variant="square">
                          {hook.enabled
                            ? t('settings.webhooks.enabled')
                            : t('settings.webhooks.disabled')}
                        </Badge>
                        {hook.consecutiveFailures > 0 ? (
                          <Badge tone="warning" variant="square">
                            {t('settings.webhooks.consecutiveFailures', {
                              count: hook.consecutiveFailures,
                            })}
                          </Badge>
                        ) : null}
                      </div>
                      <div className="mt-1 truncate font-mono text-xs text-muted-foreground">
                        {hook.url}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1">
                        {hook.events.map(e => (
                          <Badge
                            className="font-mono text-xs text-foreground-secondary"
                            key={e}
                            tone="muted"
                            variant="square"
                          >
                            {e}
                          </Badge>
                        ))}
                      </div>
                      <div className="mt-2 flex items-center gap-2 text-xs">
                        <span className="text-muted-foreground">
                          {t('settings.webhooks.signingSecret')}
                        </span>
                        {revealedSecrets.has(hook.id) ? (
                          <>
                            <code className="min-w-0 truncate rounded bg-muted px-1.5 py-0.5 text-xs">
                              {hook.signingSecret ?? t('settings.webhooks.hiddenNonAdmin')}
                            </code>
                            {hook.signingSecret ? (
                              <button
                                aria-label={t('settings.webhooks.copySecret')}
                                className={cn(
                                  'shrink-0 text-muted-foreground hover:text-foreground',
                                  TOUCH_TARGET,
                                )}
                                onClick={() => copySecret(hook.signingSecret as string)}
                                title={t('settings.webhooks.copySecret')}
                                type="button"
                              >
                                <Copy className="h-3.5 w-3.5" />
                              </button>
                            ) : null}
                          </>
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
                      {testResults[hook.id] && (
                        <p
                          aria-live="polite"
                          className={cn(
                            'mt-2 text-xs',
                            testResults[hook.id]?.status === 'success'
                              ? 'text-success-subtle-foreground'
                              : 'text-danger-subtle-foreground',
                          )}
                        >
                          {testResults[hook.id]?.status === 'success'
                            ? t('settings.webhooks.testSucceeded', {
                                status: testResults[hook.id]?.responseStatus ?? '',
                              })
                            : t('settings.webhooks.testFailedDetail', {
                                detail:
                                  testResults[hook.id]?.errorMessage ??
                                  `HTTP ${testResults[hook.id]?.responseStatus ?? '—'}`,
                              })}
                        </p>
                      )}
                    </div>
                    <div className="flex shrink-0 flex-wrap justify-end gap-1">
                      <Button
                        onClick={() => handleToggle(hook)}
                        size="xs"
                        type="button"
                        variant="outline"
                      >
                        {hook.enabled
                          ? t('settings.webhooks.disable')
                          : t('settings.webhooks.enable')}
                      </Button>
                      <Button
                        onClick={() => setEditing(hook)}
                        size="xs"
                        type="button"
                        variant="outline"
                      >
                        {t('common.edit')}
                      </Button>
                      <Button
                        disabled={!hook.enabled || testingId === hook.id}
                        onClick={() => void handleTest(hook)}
                        size="xs"
                        title={hook.enabled ? undefined : t('settings.webhooks.testNeedsEnabled')}
                        type="button"
                        variant="outline"
                      >
                        {testingId === hook.id
                          ? t('settings.webhooks.testing')
                          : t('settings.webhooks.sendTest')}
                      </Button>
                      <Button
                        onClick={() => setPendingAction({ hook, type: 'rotate' })}
                        size="xs"
                        type="button"
                        variant="outline"
                      >
                        {t('settings.webhooks.rotate')}
                      </Button>
                      <Button
                        className="text-danger-subtle-foreground hover:bg-danger-subtle"
                        onClick={() => setPendingAction({ hook, type: 'delete' })}
                        size="xs"
                        type="button"
                        variant="outline"
                      >
                        {t('common.delete')}
                      </Button>
                    </div>
                  </div>

                  {/* Deliveries: the only place a failing endpoint explains
                      itself. `consecutiveFailures` says *that* it fails; this
                      says which event, how many attempts, and what came back. */}
                  <div className="mt-3 border-t border-border pt-2">
                    <button
                      aria-expanded={showDeliveries}
                      className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                      onClick={() => toggleDeliveries(hook.id)}
                      type="button"
                    >
                      <ChevronDown
                        className={cn(
                          'h-3.5 w-3.5 transition-transform',
                          showDeliveries && 'rotate-180',
                        )}
                      />
                      {t('settings.webhooks.deliveries.title')}
                    </button>
                    {showDeliveries && (
                      <div className="mt-2">
                        <WebhookDeliveries key={deliveriesVersion} webhookId={hook.id} />
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <ModalDialog
          aria-label={t('settings.webhooks.editWebhook')}
          maxWidth="xl"
          onClose={() => setEditing(null)}
          open={editing !== null}
        >
          {editing && (
            <div className="px-5 py-4">
              <h2 className="mb-3 text-sm font-semibold text-foreground">
                {t('settings.webhooks.editWebhook')}
              </h2>
              <WebhookForm
                availableEvents={availableEvents}
                busy={creatingBusy}
                initial={{ events: editing.events, name: editing.name, url: editing.url }}
                onCancel={() => setEditing(null)}
                onSubmit={values => void handleEdit(editing, values)}
                submitLabel={t('common.save')}
              />
            </div>
          )}
        </ModalDialog>
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
    </div>
  );
}
