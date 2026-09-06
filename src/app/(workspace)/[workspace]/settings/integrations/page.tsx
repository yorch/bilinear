'use client';

import { observer } from 'mobx-react-lite';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { InlineRetry } from '@/components/shared/inline-retry';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { RowsSkeleton } from '@/components/ui/skeleton';
import { useDocumentTitle } from '@/hooks/use-document-title';
import { useFormatters } from '@/hooks/use-formatters';
import { useOrigin } from '@/hooks/use-origin';
import { useRetryableFetch } from '@/hooks/use-retryable-fetch';
import { useTranslations } from '@/hooks/use-translations';
import { gqlMutate, gqlQuery } from '@/lib/graphql';
import { toast } from '@/lib/toast';
import { getErrorMessage } from '@/lib/utils';
import { useStore } from '@/providers/store-provider';

interface GitHubIntegration {
  createdAt: string;
  githubLogin: string;
  id: string;
}

interface SlackIntegration {
  createdAt: string;
  defaultTeamId: string | null;
  id: string;
  slackTeamName: string;
}

const SLACK_INTEGRATION_QUERY = `
  query SlackIntegration {
    slackIntegration { id slackTeamName defaultTeamId createdAt }
  }
`;

const SLACK_DISCONNECT_MUTATION = `
  mutation SlackDisconnect { slackDisconnect { success } }
`;

const SLACK_SET_DEFAULT_TEAM_MUTATION = `
  mutation SlackSetDefaultTeam($teamId: ID) {
    slackSetDefaultTeam(teamId: $teamId) {
      success
      integration { id slackTeamName defaultTeamId createdAt }
    }
  }
`;

const GITHUB_INTEGRATION_QUERY = `
  query GitHubIntegration {
    githubIntegration { id githubLogin createdAt }
  }
`;

const GITHUB_DISCONNECT_MUTATION = `
  mutation GitHubDisconnect {
    githubDisconnect { success }
  }
`;

const GITHUB_ROTATE_SECRET_MUTATION = `
  mutation GitHubRotateWebhookSecret($newSecret: String!) {
    githubRotateWebhookSecret(newSecret: $newSecret) {
      success
      integration { id githubLogin createdAt }
    }
  }
`;

const IntegrationsSettingsPage = observer(function IntegrationsSettingsPage() {
  const t = useTranslations();
  useDocumentTitle(t('settings.integrations.title'));
  const { formatDate } = useFormatters();
  const { teamStore } = useStore();
  const teams = teamStore.all;
  const [connectSecret, setConnectSecret] = useState('');
  const [rotateSecret, setRotateSecret] = useState('');
  const [showRotate, setShowRotate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pendingDisconnect, setPendingDisconnect] = useState<'github' | 'slack' | null>(null);

  const { workspace: orgKey } = useParams<{ workspace: string }>();
  const appUrl = useOrigin();

  const {
    data: githubData,
    error: githubLoadError,
    loading,
    refetch: loadGithub,
    setData: setIntegration,
  } = useRetryableFetch<GitHubIntegration | null>(
    () => gqlQuery<GitHubIntegration | null>(GITHUB_INTEGRATION_QUERY, {}, 'githubIntegration'),
    [],
    null,
    { onError: () => toast.error(t('settings.integrations.loadGithubError')) },
  );

  const {
    data: slackData,
    error: slackLoadError,
    refetch: loadSlack,
    setData: setSlack,
  } = useRetryableFetch<SlackIntegration | null>(
    () => gqlQuery<SlackIntegration | null>(SLACK_INTEGRATION_QUERY, {}, 'slackIntegration'),
    [],
    null,
  );

  // `githubIntegration`/`slackIntegration` are nullable roots: a failed query
  // answers HTTP 200 with the field null *alongside* `errors`. Without these
  // flags a load failure renders as "not connected", and reconnecting would
  // mint a second webhook secret for an already-connected integration. Reading
  // them as null while the error stands keeps the "connected" badge — which
  // renders outside the error branch — from showing a stale connection.
  const integration = githubLoadError ? null : githubData;
  const slack = slackLoadError ? null : slackData;

  async function handleSlackDisconnect() {
    setSaving(true);
    try {
      await gqlMutate(SLACK_DISCONNECT_MUTATION);
      setSlack(null);
      toast.success(t('settings.integrations.slackDisconnected'));
    } catch (err) {
      toast.error(getErrorMessage(err, t('settings.integrations.slackDisconnectError')));
    } finally {
      setSaving(false);
    }
  }

  async function handleSetDefaultTeam(teamId: string) {
    try {
      const data = (await gqlMutate(SLACK_SET_DEFAULT_TEAM_MUTATION, {
        teamId: teamId || null,
      })) as {
        slackSetDefaultTeam?: { integration: SlackIntegration | null };
      };
      if (data.slackSetDefaultTeam?.integration) {
        setSlack(data.slackSetDefaultTeam.integration);
      }
      toast.success(t('settings.integrations.defaultTeamUpdated'));
    } catch (err) {
      toast.error(getErrorMessage(err, t('settings.integrations.defaultTeamUpdateError')));
    }
  }

  function handleConnect() {
    if (connectSecret.trim().length < 16) {
      toast.error(t('settings.integrations.webhookSecretTooShort'));
      return;
    }
    const url = `/api/integrations/github?webhookSecret=${encodeURIComponent(connectSecret.trim())}`;
    window.location.href = url;
  }

  async function handleDisconnect() {
    setSaving(true);
    try {
      await gqlMutate(GITHUB_DISCONNECT_MUTATION);
      setIntegration(null);
      toast.success(t('settings.integrations.githubDisconnected'));
    } catch (err) {
      toast.error(getErrorMessage(err, t('settings.integrations.githubDisconnectError')));
    } finally {
      setSaving(false);
    }
  }

  async function handleRotateSecret() {
    if (rotateSecret.trim().length < 16) {
      toast.error(t('settings.integrations.newSecretTooShort'));
      return;
    }
    setSaving(true);
    try {
      // gqlMutate throws on a GraphQL-level failure, so the "updated" toast can
      // never claim a secret the server never stored (which would silently break
      // HMAC verification for every inbound webhook).
      const data = (await gqlMutate(GITHUB_ROTATE_SECRET_MUTATION, {
        newSecret: rotateSecret.trim(),
      })) as {
        githubRotateWebhookSecret?: { success: boolean; integration: GitHubIntegration | null };
      };
      if (data.githubRotateWebhookSecret?.integration) {
        setIntegration(data.githubRotateWebhookSecret.integration);
      }
      setRotateSecret('');
      setShowRotate(false);
      toast.success(t('settings.integrations.webhookSecretUpdated'));
    } catch (err) {
      toast.error(getErrorMessage(err, t('settings.integrations.webhookSecretUpdateError')));
    } finally {
      setSaving(false);
    }
  }

  const webhookUrl = `${appUrl}/api/integrations/github/webhook?org=${orgKey}`;

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      <PageHeader
        description={t('settings.integrations.description')}
        title={t('settings.integrations.title')}
      />
      <div className="mx-auto w-full max-w-2xl space-y-8 p-8">
        {/* GitHub */}
        <section className="rounded-lg border p-6 space-y-4">
          <div className="flex items-center gap-3">
            {/* GitHub mark SVG */}
            <svg aria-hidden="true" className="h-6 w-6" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
            </svg>
            <div>
              <h2 className="font-medium">{t('settings.integrations.github')}</h2>
              <p className="text-sm text-muted-foreground">
                {t('settings.integrations.githubDescription')}
              </p>
            </div>
            {integration && (
              <span className="ml-auto rounded-full bg-success-subtle px-2.5 py-0.5 text-xs font-medium text-success-subtle-foreground">
                {t('settings.integrations.connected')}
              </span>
            )}
          </div>

          {loading ? (
            <RowsSkeleton count={3} />
          ) : githubLoadError ? (
            <InlineRetry
              message={t('settings.integrations.loadGithubError')}
              onRetry={() => void loadGithub()}
            />
          ) : integration ? (
            <div className="space-y-4">
              <div className="rounded-md bg-muted/50 px-4 py-3 text-sm">
                <p>
                  {t('settings.integrations.connectedAs', { login: integration.githubLogin })}{' '}
                  {formatDate(integration.createdAt)}
                </p>
                <p className="mt-2 text-muted-foreground">
                  {t('settings.integrations.webhookUrlHint')}
                </p>
                <code className="mt-1 block break-all rounded bg-muted px-2 py-1 font-mono text-xs">
                  {webhookUrl}
                </code>
              </div>

              <div className="flex gap-2">
                <button
                  className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
                  onClick={() => setShowRotate(v => !v)}
                  type="button"
                >
                  {t('settings.integrations.rotateWebhookSecret')}
                </button>
                <button
                  className="rounded-md border border-destructive/50 px-3 py-1.5 text-sm text-destructive hover:bg-destructive/10 disabled:opacity-50"
                  disabled={saving}
                  onClick={() => setPendingDisconnect('github')}
                  type="button"
                >
                  {t('settings.integrations.disconnect')}
                </button>
              </div>

              {showRotate && (
                <div className="flex gap-2">
                  <input
                    className="flex-1 rounded-md border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    onChange={e => setRotateSecret(e.target.value)}
                    placeholder={t('settings.integrations.newWebhookSecretPlaceholder')}
                    type="text"
                    value={rotateSecret}
                  />
                  <Button disabled={saving} onClick={handleRotateSecret} size="sm" type="button">
                    {t('common.save')}
                  </Button>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                {t('settings.integrations.webhookSecretInstructions')}
              </p>
              <div className="flex gap-2">
                <input
                  className="flex-1 rounded-md border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  onChange={e => setConnectSecret(e.target.value)}
                  placeholder={t('settings.integrations.webhookSecretPlaceholder')}
                  type="text"
                  value={connectSecret}
                />
                <Button onClick={handleConnect} size="sm" type="button">
                  {t('settings.integrations.connectGithub')}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {t('settings.integrations.afterConnectingHint')}
                <br />
                <code className="font-mono">{webhookUrl}</code>
              </p>
            </div>
          )}
        </section>

        {/* Slack */}
        <section className="rounded-lg border p-6 space-y-4">
          <div className="flex items-center gap-3">
            <svg aria-hidden="true" className="h-6 w-6" viewBox="0 0 24 24">
              <path
                d="M6 15a2 2 0 1 1-2-2h2v2zm1 0a2 2 0 0 1 4 0v5a2 2 0 1 1-4 0v-5zm2-8a2 2 0 1 1 2-2v2H9zm0 1a2 2 0 0 1 0 4H4a2 2 0 1 1 0-4h5zm8 2a2 2 0 1 1 2 2h-2v-2zm-1 0a2 2 0 0 1-4 0V5a2 2 0 1 1 4 0v5zm-2 8a2 2 0 1 1-2 2v-2h2zm0-1a2 2 0 0 1 0-4h5a2 2 0 1 1 0 4h-5z"
                fill="currentColor"
              />
            </svg>
            <div>
              <h2 className="font-medium">{t('settings.integrations.slack')}</h2>
              <p className="text-sm text-muted-foreground">
                {t('settings.integrations.slackDescriptionPrefix')}{' '}
                <code className="font-mono">/bilinear</code>{' '}
                {t('settings.integrations.slackDescriptionSuffix')}
              </p>
            </div>
            {slack && (
              <span className="ml-auto rounded-full bg-success-subtle px-2.5 py-0.5 text-xs font-medium text-success-subtle-foreground">
                {t('settings.integrations.connected')}
              </span>
            )}
          </div>

          {slackLoadError ? (
            <InlineRetry
              message={t('common.somethingWentWrong')}
              onRetry={() => void loadSlack()}
            />
          ) : slack ? (
            <div className="space-y-4">
              <div className="rounded-md bg-muted/50 px-4 py-3 text-sm">
                <p>
                  {t('settings.integrations.connectedTo', { name: slack.slackTeamName })}{' '}
                  {formatDate(slack.createdAt)}
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1" htmlFor="slack-default-team">
                  {t('settings.integrations.defaultTeamForNewIssues')}
                </label>
                <select
                  className="w-full rounded-md border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  id="slack-default-team"
                  onChange={e => void handleSetDefaultTeam(e.target.value)}
                  value={slack.defaultTeamId ?? ''}
                >
                  <option value="">{t('settings.integrations.chooseATeam')}</option>
                  {teams.map(team => (
                    <option key={team.id} value={team.id}>
                      {team.name}
                    </option>
                  ))}
                </select>
              </div>
              <button
                className="rounded-md border border-destructive/50 px-3 py-1.5 text-sm text-destructive hover:bg-destructive/10 disabled:opacity-50"
                disabled={saving}
                onClick={() => setPendingDisconnect('slack')}
                type="button"
              >
                {t('settings.integrations.disconnect')}
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                {t('settings.integrations.connectSlackHintPrefix')}{' '}
                <code className="font-mono">/bilinear</code>{' '}
                {t('settings.integrations.connectSlackHintSuffix')}
              </p>
              <code className="block break-all rounded bg-muted px-2 py-1 font-mono text-xs">
                {appUrl}/api/integrations/slack/commands
              </code>
              <Button asChild size="sm">
                <a href="/api/integrations/slack">{t('settings.integrations.connectSlack')}</a>
              </Button>
            </div>
          )}
        </section>

        <ConfirmDialog
          confirmLabel={t('settings.integrations.disconnect')}
          message={
            pendingDisconnect === 'slack'
              ? t('settings.integrations.disconnectSlackConfirm')
              : t('settings.integrations.disconnectGithubConfirm')
          }
          onCancel={() => setPendingDisconnect(null)}
          onConfirm={() => {
            if (pendingDisconnect === 'slack') {
              void handleSlackDisconnect();
            } else if (pendingDisconnect === 'github') {
              void handleDisconnect();
            }
            setPendingDisconnect(null);
          }}
          open={pendingDisconnect !== null}
          title={t('settings.integrations.disconnect')}
        />
      </div>
    </div>
  );
});

export default IntegrationsSettingsPage;
