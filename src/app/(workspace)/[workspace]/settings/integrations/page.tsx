'use client';

import { useEffect, useState } from 'react';
import { gql } from '@/lib/graphql';
import { toast } from '@/lib/toast';

interface GitHubIntegration {
  createdAt: string;
  githubLogin: string;
  id: string;
}

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

export default function IntegrationsSettingsPage() {
  const [integration, setIntegration] = useState<GitHubIntegration | null>(null);
  const [loading, setLoading] = useState(true);
  const [connectSecret, setConnectSecret] = useState('');
  const [rotateSecret, setRotateSecret] = useState('');
  const [showRotate, setShowRotate] = useState(false);
  const [saving, setSaving] = useState(false);

  const appUrl = typeof window !== 'undefined' ? window.location.origin : '';
  const orgKey = typeof window !== 'undefined' ? window.location.pathname.split('/')[1] : '';

  useEffect(() => {
    gql(GITHUB_INTEGRATION_QUERY)
      .then(res => {
        const data = (res.data ?? {}) as { githubIntegration?: GitHubIntegration | null };
        setIntegration(data.githubIntegration ?? null);
      })
      .catch(() => toast.error('Failed to load GitHub integration'))
      .finally(() => setLoading(false));
  }, []);

  function handleConnect() {
    if (connectSecret.trim().length < 16) {
      toast.error('Webhook secret must be at least 16 characters');
      return;
    }
    const url = `/api/integrations/github?webhookSecret=${encodeURIComponent(connectSecret.trim())}`;
    window.location.href = url;
  }

  async function handleDisconnect() {
    if (!confirm('Disconnect GitHub? Linked pull requests will be removed.')) {
      return;
    }
    setSaving(true);
    try {
      await gql(GITHUB_DISCONNECT_MUTATION);
      setIntegration(null);
      toast.success('GitHub disconnected');
    } catch {
      toast.error('Failed to disconnect GitHub');
    } finally {
      setSaving(false);
    }
  }

  async function handleRotateSecret() {
    if (rotateSecret.trim().length < 16) {
      toast.error('New secret must be at least 16 characters');
      return;
    }
    setSaving(true);
    try {
      const res = await gql(GITHUB_ROTATE_SECRET_MUTATION, { newSecret: rotateSecret.trim() });
      const data = (res.data ?? {}) as {
        githubRotateWebhookSecret?: { success: boolean; integration: GitHubIntegration };
      };
      if (data.githubRotateWebhookSecret?.integration) {
        setIntegration(data.githubRotateWebhookSecret.integration);
      }
      setRotateSecret('');
      setShowRotate(false);
      toast.success('Webhook secret updated');
    } catch {
      toast.error('Failed to rotate webhook secret');
    } finally {
      setSaving(false);
    }
  }

  const webhookUrl = `${appUrl}/api/integrations/github/webhook?org=${orgKey}`;

  return (
    <div className="mx-auto max-w-2xl space-y-8 p-8">
      <div>
        <h1 className="text-xl font-semibold">Integrations</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Connect external services to your workspace.
        </p>
      </div>

      {/* GitHub */}
      <section className="rounded-lg border p-6 space-y-4">
        <div className="flex items-center gap-3">
          {/* GitHub mark SVG */}
          <svg aria-hidden="true" className="h-6 w-6" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
          </svg>
          <div>
            <h2 className="font-medium">GitHub</h2>
            <p className="text-sm text-muted-foreground">
              Link pull requests to issues and auto-close on merge.
            </p>
          </div>
          {integration && (
            <span className="ml-auto rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-800 dark:bg-green-900/30 dark:text-green-400">
              Connected
            </span>
          )}
        </div>

        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : integration ? (
          <div className="space-y-4">
            <div className="rounded-md bg-muted/50 px-4 py-3 text-sm">
              <p>
                Connected as <strong>{integration.githubLogin}</strong> on{' '}
                {new Date(integration.createdAt).toLocaleDateString()}
              </p>
              <p className="mt-2 text-muted-foreground">
                Webhook URL (configure this in your GitHub repo or org settings):
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
                Rotate webhook secret
              </button>
              <button
                className="rounded-md border border-destructive/50 px-3 py-1.5 text-sm text-destructive hover:bg-destructive/10 disabled:opacity-50"
                disabled={saving}
                onClick={handleDisconnect}
                type="button"
              >
                Disconnect
              </button>
            </div>

            {showRotate && (
              <div className="flex gap-2">
                <input
                  className="flex-1 rounded-md border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  onChange={e => setRotateSecret(e.target.value)}
                  placeholder="New webhook secret (min 16 chars)"
                  type="text"
                  value={rotateSecret}
                />
                <button
                  className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                  disabled={saving}
                  onClick={handleRotateSecret}
                  type="button"
                >
                  Save
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Enter a webhook secret that you'll configure in GitHub when setting up the webhook. It
              must be at least 16 characters. Keep it secret — it's used to verify that incoming
              events are genuinely from GitHub.
            </p>
            <div className="flex gap-2">
              <input
                className="flex-1 rounded-md border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                onChange={e => setConnectSecret(e.target.value)}
                placeholder="Webhook secret (min 16 chars)"
                type="text"
                value={connectSecret}
              />
              <button
                className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                onClick={handleConnect}
                type="button"
              >
                Connect GitHub
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              After connecting, configure your GitHub webhook to point to:
              <br />
              <code className="font-mono">{webhookUrl}</code>
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
