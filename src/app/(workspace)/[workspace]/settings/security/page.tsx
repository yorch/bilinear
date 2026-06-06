'use client';

import { Copy, ExternalLink } from 'lucide-react';
import { useEffect, useState } from 'react';
import { gql } from '@/lib/graphql';
import { toast } from '@/lib/toast';

// ---------------------------------------------------------------------------
// GraphQL
// ---------------------------------------------------------------------------

const SAML_QUERY = `
  query SamlConfiguration {
    samlConfiguration {
      id
      emailAttribute
      enabled
      idpEntityId
      idpMetadataUrl
      idpSsoUrl
      jitProvisioning
      nameAttribute
      ssoEnforced
      updatedAt
    }
  }
`;

const SAML_SAVE_MUTATION = `
  mutation SamlConfigurationSave($input: SamlConfigurationInput!) {
    samlConfigurationSave(input: $input) {
      success
      configuration {
        id
        emailAttribute
        enabled
        idpEntityId
        idpMetadataUrl
        idpSsoUrl
        jitProvisioning
        nameAttribute
        ssoEnforced
        updatedAt
      }
    }
  }
`;

const SAML_DELETE_MUTATION = `
  mutation SamlConfigurationDelete {
    samlConfigurationDelete { success lastSyncId }
  }
`;

// ---------------------------------------------------------------------------
// SCIM GraphQL
// ---------------------------------------------------------------------------

const SCIM_TOKENS_QUERY = `
  query ScimTokens {
    scimTokens { id label lastUsedAt createdAt }
  }
`;

const SCIM_TOKEN_CREATE_MUTATION = `
  mutation ScimTokenCreate($label: String!) {
    scimTokenCreate(label: $label) {
      success
      plaintext
      token { id label lastUsedAt createdAt }
    }
  }
`;

const SCIM_TOKEN_REVOKE_MUTATION = `
  mutation ScimTokenRevoke($id: ID!) {
    scimTokenRevoke(id: $id) { success }
  }
`;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SamlConfig {
  emailAttribute: string;
  enabled: boolean;
  id: string;
  idpEntityId: string;
  idpMetadataUrl: string | null;
  idpSsoUrl: string;
  jitProvisioning: boolean;
  nameAttribute: string;
  ssoEnforced: boolean;
  updatedAt: string;
}

interface FormState {
  emailAttribute: string;
  enabled: boolean;
  idpCert: string;
  idpEntityId: string;
  idpMetadataUrl: string;
  idpSsoUrl: string;
  jitProvisioning: boolean;
  nameAttribute: string;
  ssoEnforced: boolean;
}

interface ScimTokenRow {
  createdAt: string;
  id: string;
  label: string;
  lastUsedAt: string | null;
}

const DEFAULT_FORM: FormState = {
  emailAttribute: 'email',
  enabled: false,
  idpCert: '',
  idpEntityId: '',
  idpMetadataUrl: '',
  idpSsoUrl: '',
  jitProvisioning: true,
  nameAttribute: 'name',
  ssoEnforced: false,
};

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function SecuritySettingsPage() {
  const [config, setConfig] = useState<SamlConfig | null>(null);
  const [form, setForm] = useState<FormState>(DEFAULT_FORM);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // SCIM state
  const [scimTokens, setScimTokens] = useState<ScimTokenRow[]>([]);
  const [scimLoading, setScimLoading] = useState(true);
  const [scimCreating, setScimCreating] = useState(false);
  const [scimNewLabel, setScimNewLabel] = useState('');
  const [scimNewPlaintext, setScimNewPlaintext] = useState<string | null>(null);

  const orgKey = typeof window !== 'undefined' ? window.location.pathname.split('/')[1] : '';
  const appUrl = typeof window !== 'undefined' ? window.location.origin : '';

  const spEntityId = `${appUrl}/api/auth/saml/metadata?org=${orgKey}`;
  const acsUrl = `${appUrl}/api/auth/saml/callback`;
  const metadataUrl = `${appUrl}/api/auth/saml/metadata?org=${orgKey}`;

  useEffect(() => {
    gql(SAML_QUERY)
      .then(res => {
        const data = (res.data ?? {}) as { samlConfiguration?: SamlConfig | null };
        const cfg = data.samlConfiguration ?? null;
        setConfig(cfg);
        if (cfg) {
          setForm({
            emailAttribute: cfg.emailAttribute,
            enabled: cfg.enabled,
            idpCert: '',
            idpEntityId: cfg.idpEntityId,
            idpMetadataUrl: cfg.idpMetadataUrl ?? '',
            idpSsoUrl: cfg.idpSsoUrl,
            jitProvisioning: cfg.jitProvisioning,
            nameAttribute: cfg.nameAttribute,
            ssoEnforced: cfg.ssoEnforced,
          });
        }
      })
      .catch(() => {
        // Non-admin users get a FORBIDDEN — degrade gracefully
      })
      .finally(() => {
        setLoading(false);
      });

    gql(SCIM_TOKENS_QUERY)
      .then(res => {
        const data = (res.data ?? {}) as { scimTokens?: ScimTokenRow[] };
        setScimTokens(data.scimTokens ?? []);
      })
      .catch(() => {
        // Non-admin — degrade gracefully
      })
      .finally(() => {
        setScimLoading(false);
      });
  }, []);

  async function handleScimCreate() {
    if (!scimNewLabel.trim()) {
      toast.error('Label is required');
      return;
    }
    setScimCreating(true);
    try {
      const res = await gql(SCIM_TOKEN_CREATE_MUTATION, { label: scimNewLabel.trim() });
      const data = (res.data ?? {}) as {
        scimTokenCreate?: { plaintext?: string; success: boolean; token?: ScimTokenRow };
      };
      const created = data.scimTokenCreate;
      if (created?.token) {
        setScimTokens(t => [created.token as ScimTokenRow, ...t]);
        setScimNewPlaintext(created.plaintext ?? null);
        setScimNewLabel('');
        toast.success('SCIM token created');
      }
    } catch {
      toast.error('Failed to create SCIM token');
    } finally {
      setScimCreating(false);
    }
  }

  async function handleScimRevoke(tokenId: string) {
    if (!confirm('Revoke this SCIM token? Existing provisioning integrations will stop working.')) {
      return;
    }
    try {
      await gql(SCIM_TOKEN_REVOKE_MUTATION, { id: tokenId });
      setScimTokens(t => t.filter(tok => tok.id !== tokenId));
      toast.success('Token revoked');
    } catch {
      toast.error('Failed to revoke token');
    }
  }

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm(prev => ({ ...prev, [key]: value }));
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!form.idpSsoUrl.trim()) {
      toast.error('IDP SSO URL is required');
      return;
    }
    if (!form.idpEntityId.trim()) {
      toast.error('IDP Entity ID is required');
      return;
    }
    if (!form.idpCert.trim() && !config) {
      toast.error('IDP Certificate is required');
      return;
    }
    setSaving(true);
    try {
      const res = await gql(SAML_SAVE_MUTATION, {
        input: {
          emailAttribute: form.emailAttribute || 'email',
          enabled: form.enabled,
          idpCert: form.idpCert.trim() || undefined,
          idpEntityId: form.idpEntityId.trim(),
          idpMetadataUrl: form.idpMetadataUrl.trim() || undefined,
          idpSsoUrl: form.idpSsoUrl.trim(),
          jitProvisioning: form.jitProvisioning,
          nameAttribute: form.nameAttribute || 'name',
          ssoEnforced: form.ssoEnforced,
        },
      });
      const data = (res.data ?? {}) as {
        samlConfigurationSave?: { configuration?: SamlConfig; success: boolean };
      };
      if (data.samlConfigurationSave?.configuration) {
        setConfig(data.samlConfigurationSave.configuration);
        setField('idpCert', '');
        toast.success('SAML configuration saved');
      }
    } catch {
      toast.error('Failed to save SAML configuration');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!confirm('Remove SAML configuration? SSO will be disabled immediately.')) {
      return;
    }
    setDeleting(true);
    try {
      await gql(SAML_DELETE_MUTATION);
      setConfig(null);
      setForm(DEFAULT_FORM);
      toast.success('SAML configuration removed');
    } catch {
      toast.error('Failed to remove SAML configuration');
    } finally {
      setDeleting(false);
    }
  }

  function copyToClipboard(value: string, label: string) {
    void navigator.clipboard.writeText(value);
    toast.success(`${label} copied to clipboard`);
  }

  return (
    <div className="mx-auto max-w-2xl space-y-8 p-8">
      <div>
        <h1 className="text-xl font-semibold">Security</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Configure single sign-on and authentication settings.
        </p>
      </div>

      {/* SCIM Provisioning Section */}
      <section className="rounded-lg border p-6 space-y-6">
        <div>
          <h2 className="font-medium">SCIM 2.0 Provisioning</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Automate user and group provisioning from your Identity Provider.
          </p>
        </div>

        {/* Base URL */}
        <div className="rounded-md bg-muted/50 p-4 space-y-3">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            SCIM Base URL
          </p>
          <ReadOnlyField
            label="Use this URL in your IdP's SCIM configuration"
            onCopy={() => copyToClipboard(`${appUrl}/api/scim/v2`, 'SCIM Base URL')}
            value={`${appUrl}/api/scim/v2`}
          />
        </div>

        {/* Tokens */}
        <div className="space-y-3">
          <p className="text-sm font-medium">Bearer Tokens</p>

          {scimLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            <>
              {scimTokens.length === 0 ? (
                <p className="text-sm text-muted-foreground">No active tokens.</p>
              ) : (
                <div className="space-y-2">
                  {scimTokens.map(tok => (
                    <div
                      className="flex items-center justify-between rounded-md border px-3 py-2"
                      key={tok.id}
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{tok.label}</p>
                        <p className="text-xs text-muted-foreground">
                          Created {new Date(tok.createdAt).toLocaleDateString()}
                          {tok.lastUsedAt
                            ? ` · Last used ${new Date(tok.lastUsedAt).toLocaleDateString()}`
                            : ' · Never used'}
                        </p>
                      </div>
                      <button
                        className="ml-3 shrink-0 rounded-md border border-destructive/50 px-2.5 py-1 text-xs text-destructive hover:bg-destructive/10"
                        onClick={() => handleScimRevoke(tok.id)}
                        type="button"
                      >
                        Revoke
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* New token form */}
              {scimNewPlaintext ? (
                <div className="rounded-md border border-amber-300 bg-amber-50 p-3 space-y-2 dark:border-amber-700 dark:bg-amber-950/30">
                  <p className="text-xs font-medium text-amber-800 dark:text-amber-300">
                    Copy this token now — it will not be shown again.
                  </p>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 truncate rounded bg-white/70 px-2 py-1 font-mono text-xs dark:bg-black/30">
                      {scimNewPlaintext}
                    </code>
                    <button
                      className="shrink-0 text-muted-foreground hover:text-foreground"
                      onClick={() => copyToClipboard(scimNewPlaintext, 'SCIM token')}
                      title="Copy token"
                      type="button"
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <button
                    className="text-xs text-muted-foreground hover:text-foreground underline"
                    onClick={() => setScimNewPlaintext(null)}
                    type="button"
                  >
                    I have copied it
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <input
                    className="flex-1 rounded-md border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    onChange={e => setScimNewLabel(e.target.value)}
                    placeholder="Token label (e.g. Okta)"
                    type="text"
                    value={scimNewLabel}
                  />
                  <button
                    className="shrink-0 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                    disabled={scimCreating || !scimNewLabel.trim()}
                    onClick={handleScimCreate}
                    type="button"
                  >
                    {scimCreating ? 'Creating…' : 'Create token'}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </section>

      {/* SAML SSO Section */}
      <section className="rounded-lg border p-6 space-y-6">
        <div>
          <h2 className="font-medium">SAML 2.0 Single Sign-On</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Connect an Identity Provider (IdP) to enable SSO for your workspace.
          </p>
          {config && (
            <span className="inline-block mt-2 rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-800 dark:bg-green-900/30 dark:text-green-400">
              Configured
            </span>
          )}
        </div>

        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <>
            {/* SP (Service Provider) read-only info */}
            <div className="rounded-md bg-muted/50 p-4 space-y-3">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Service Provider Details
              </p>
              <div className="space-y-2">
                <ReadOnlyField
                  label="SP Entity ID / Metadata URL"
                  onCopy={() => copyToClipboard(spEntityId, 'Metadata URL')}
                  value={metadataUrl}
                />
                <ReadOnlyField
                  label="Assertion Consumer Service (ACS) URL"
                  onCopy={() => copyToClipboard(acsUrl, 'ACS URL')}
                  value={acsUrl}
                />
              </div>
            </div>

            {/* Configuration form */}
            <form className="space-y-4" onSubmit={handleSave}>
              <div>
                <label className="block text-sm font-medium mb-1" htmlFor="idpSsoUrl">
                  IDP SSO URL <span className="text-destructive">*</span>
                </label>
                <input
                  className="w-full rounded-md border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  id="idpSsoUrl"
                  onChange={e => setField('idpSsoUrl', e.target.value)}
                  placeholder="https://your-idp.example.com/sso/saml"
                  type="url"
                  value={form.idpSsoUrl}
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1" htmlFor="idpEntityId">
                  IDP Entity ID <span className="text-destructive">*</span>
                </label>
                <input
                  className="w-full rounded-md border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  id="idpEntityId"
                  onChange={e => setField('idpEntityId', e.target.value)}
                  placeholder="https://your-idp.example.com/entity"
                  type="text"
                  value={form.idpEntityId}
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1" htmlFor="idpCert">
                  IDP Certificate (PEM){config ? ' — leave blank to keep existing' : ' *'}
                </label>
                <textarea
                  className="w-full rounded-md border bg-background px-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ring"
                  id="idpCert"
                  onChange={e => setField('idpCert', e.target.value)}
                  placeholder={'-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----'}
                  rows={4}
                  value={form.idpCert}
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1" htmlFor="idpMetadataUrl">
                  IDP Metadata URL (optional)
                </label>
                <input
                  className="w-full rounded-md border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  id="idpMetadataUrl"
                  onChange={e => setField('idpMetadataUrl', e.target.value)}
                  placeholder="https://your-idp.example.com/metadata"
                  type="url"
                  value={form.idpMetadataUrl}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1" htmlFor="emailAttribute">
                    Email attribute
                  </label>
                  <input
                    className="w-full rounded-md border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    id="emailAttribute"
                    onChange={e => setField('emailAttribute', e.target.value)}
                    type="text"
                    value={form.emailAttribute}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1" htmlFor="nameAttribute">
                    Name attribute
                  </label>
                  <input
                    className="w-full rounded-md border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    id="nameAttribute"
                    onChange={e => setField('nameAttribute', e.target.value)}
                    type="text"
                    value={form.nameAttribute}
                  />
                </div>
              </div>

              {/* Toggles */}
              <div className="space-y-3 pt-1">
                <Toggle
                  checked={form.enabled}
                  description="Allow members to authenticate via SSO"
                  label="Enable SAML SSO"
                  onChange={v => setField('enabled', v)}
                />
                <Toggle
                  checked={form.jitProvisioning}
                  description="Automatically create accounts for new SSO users"
                  label="Just-in-time provisioning"
                  onChange={v => setField('jitProvisioning', v)}
                />
                <Toggle
                  checked={form.ssoEnforced}
                  description="Require all members to sign in via SSO"
                  label="Enforce SSO"
                  onChange={v => setField('ssoEnforced', v)}
                />
              </div>

              <div className="flex items-center gap-3 pt-2">
                <button
                  className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                  disabled={saving}
                  type="submit"
                >
                  {saving ? 'Saving…' : 'Save configuration'}
                </button>

                {config && (
                  <>
                    <a
                      className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
                      href={`/api/auth/saml/initiate?org=${orgKey}&redirect=/settings/security`}
                      rel="noreferrer"
                      target="_blank"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      Test SSO
                    </a>

                    <button
                      className="rounded-md border border-destructive/50 px-3 py-1.5 text-sm text-destructive hover:bg-destructive/10 disabled:opacity-50"
                      disabled={deleting}
                      onClick={handleDelete}
                      type="button"
                    >
                      {deleting ? 'Removing…' : 'Remove'}
                    </button>
                  </>
                )}
              </div>
            </form>
          </>
        )}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ReadOnlyField({
  label,
  onCopy,
  value,
}: {
  label: string;
  onCopy: () => void;
  value: string;
}) {
  return (
    <div>
      <p className="text-xs text-muted-foreground mb-1">{label}</p>
      <div className="flex items-center gap-2">
        <code className="flex-1 truncate rounded bg-muted px-2 py-1 font-mono text-xs">
          {value}
        </code>
        <button
          className="shrink-0 text-muted-foreground hover:text-foreground"
          onClick={onCopy}
          title="Copy"
          type="button"
        >
          <Copy className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

function Toggle({
  checked,
  description,
  label,
  onChange,
}: {
  checked: boolean;
  description: string;
  label: string;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <button
        aria-checked={checked}
        aria-label={label}
        className={[
          'relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors',
          'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
          checked ? 'bg-primary' : 'bg-muted-foreground/30',
        ].join(' ')}
        onClick={() => onChange(!checked)}
        role="switch"
        type="button"
      >
        <span
          className={[
            'inline-block h-4 w-4 rounded-full bg-white shadow transition-transform',
            checked ? 'translate-x-4' : 'translate-x-0',
          ].join(' ')}
        />
      </button>
    </div>
  );
}
