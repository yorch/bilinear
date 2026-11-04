'use client';

import { Copy, ExternalLink } from 'lucide-react';
import { useParams } from 'next/navigation';
import { useRef, useState } from 'react';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { LoadError } from '@/components/shared/load-error';
import { ReadOnlyField } from '@/components/shared/read-only-field';
import { SettingToggleRow } from '@/components/shared/setting-toggle-row';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { RowsSkeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { useDocumentTitle } from '@/hooks/use-document-title';
import { useFormatters } from '@/hooks/use-formatters';
import { useOrigin } from '@/hooks/use-origin';
import { useRetryableFetch } from '@/hooks/use-retryable-fetch';
import { useTranslations } from '@/hooks/use-translations';
import { gqlMutate, gqlQuery } from '@/lib/graphql';
import { toast } from '@/lib/toast';
import { cn, TOUCH_TARGET } from '@/lib/utils';

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
    samlConfigurationDelete { success }
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
  const t = useTranslations();
  useDocumentTitle(t('settings.security.title'));
  const { formatDate } = useFormatters();
  const [form, setForm] = useState<FormState>(DEFAULT_FORM);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [pendingAction, setPendingAction] = useState<
    { tokenId: string; type: 'revokeScim' } | { type: 'enforceSso' } | { type: 'removeSaml' } | null
  >(null);
  const [errors, setErrors] = useState<{
    idpCert?: string;
    idpEntityId?: string;
    idpSsoUrl?: string;
  }>({});
  const ssoUrlRef = useRef<HTMLInputElement>(null);
  const entityIdRef = useRef<HTMLInputElement>(null);
  const certRef = useRef<HTMLTextAreaElement>(null);

  // SCIM state
  const [scimCreating, setScimCreating] = useState(false);
  const [scimNewLabel, setScimNewLabel] = useState('');
  const [scimNewPlaintext, setScimNewPlaintext] = useState<string | null>(null);

  const { workspace: orgKey } = useParams<{ workspace: string }>();
  const appUrl = useOrigin();

  const spEntityId = `${appUrl}/api/auth/saml/metadata?org=${orgKey}`;
  const acsUrl = `${appUrl}/api/auth/saml/callback`;
  const metadataUrl = `${appUrl}/api/auth/saml/metadata?org=${orgKey}`;

  const {
    cause: samlCause,
    data: samlData,
    error: samlFailed,
    loading,
    refetch: reloadSaml,
    setData: setConfig,
  } = useRetryableFetch<SamlConfig | null>(
    // `samlConfiguration` is a *nullable* root field, so a FORBIDDEN from
    // `requireSamlAdmin` comes back as `data: { samlConfiguration: null }`
    // *alongside* `errors` — a genuine partial response. A null field on its
    // own therefore can't be read as "SSO is not configured": doing so would
    // show an empty form to someone who may then overwrite a live IdP config.
    // Only a clean, error-free response means "not configured" — which is
    // exactly what `gqlQuery` guarantees, since it throws whenever `errors` is
    // present rather than handing back the partial payload.
    () => gqlQuery<SamlConfig | null>(SAML_QUERY, {}, 'samlConfiguration'),
    [],
    null,
    {
      onData: cfg => {
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
      },
    },
  );

  const {
    cause: scimCause,
    data: scimData,
    error: scimFailed,
    loading: scimLoading,
    refetch: reloadScim,
    setData: setScimTokens,
  } = useRetryableFetch<ScimTokenRow[]>(
    // Same treatment as SAML above: `scimTokens` is org-admin-only, so an
    // ordinary member visiting this page gets FORBIDDEN on a request they never
    // asked to make. That is "you can't see this", not a failure — rendering it
    // in destructive red would alarm every non-admin. A failed read must still
    // never fall through to "No active tokens.", which would tell an admin
    // auditing credentials that there are none.
    async () => (await gqlQuery<ScimTokenRow[] | null>(SCIM_TOKENS_QUERY, {}, 'scimTokens')) ?? [],
    [],
    [],
  );

  // A failed read must not leave the last-known data on screen: the SAML form
  // would invite an overwrite of a config we no longer know, and a stale token
  // list would misreport which credentials are live. `LoadError` below tells a
  // refused read (muted, nothing to retry) from a genuine failure.
  const config = samlFailed ? null : samlData;
  const scimTokens = scimFailed ? [] : scimData;

  async function handleScimCreate() {
    if (!scimNewLabel.trim()) {
      toast.error(t('settings.security.labelRequired'));
      return;
    }
    setScimCreating(true);
    try {
      const created = await gqlQuery<{
        plaintext?: string;
        success: boolean;
        token?: ScimTokenRow;
      } | null>(SCIM_TOKEN_CREATE_MUTATION, { label: scimNewLabel.trim() }, 'scimTokenCreate');
      if (!created?.token) {
        toast.error(t('settings.security.scimTokenCreateError'));
        return;
      }
      setScimTokens(prev => [created.token as ScimTokenRow, ...prev]);
      setScimNewPlaintext(created.plaintext ?? null);
      setScimNewLabel('');
      toast.success(t('settings.security.scimTokenCreated'));
    } catch {
      toast.error(t('settings.security.scimTokenCreateError'));
    } finally {
      setScimCreating(false);
    }
  }

  async function handleScimRevoke(tokenId: string) {
    try {
      await gqlMutate(SCIM_TOKEN_REVOKE_MUTATION, { id: tokenId });
      setScimTokens(prev => prev.filter(tok => tok.id !== tokenId));
      toast.success(t('settings.security.tokenRevoked'));
    } catch {
      toast.error(t('settings.security.tokenRevokeError'));
    }
  }

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm(prev => ({ ...prev, [key]: value }));
    if (key === 'idpSsoUrl' || key === 'idpEntityId' || key === 'idpCert') {
      setErrors(prev => ({ ...prev, [key]: undefined }));
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    // Inline, field-attached errors; focus lands on the first invalid field.
    const next: typeof errors = {};
    if (!form.idpSsoUrl.trim()) {
      next.idpSsoUrl = t('settings.security.idpSsoUrlRequired');
    }
    if (!form.idpEntityId.trim()) {
      next.idpEntityId = t('settings.security.idpEntityIdRequired');
    }
    if (!form.idpCert.trim() && !config) {
      next.idpCert = t('settings.security.idpCertRequired');
    }
    setErrors(next);
    if (next.idpSsoUrl || next.idpEntityId || next.idpCert) {
      (next.idpSsoUrl ? ssoUrlRef : next.idpEntityId ? entityIdRef : certRef).current?.focus();
      return;
    }
    setSaving(true);
    try {
      const saved = await gqlQuery<{ configuration?: SamlConfig; success: boolean } | null>(
        SAML_SAVE_MUTATION,
        {
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
        },
        'samlConfigurationSave',
      );
      if (!saved?.configuration) {
        toast.error(t('settings.security.samlConfigSaveError'));
        return;
      }
      setConfig(saved.configuration);
      setField('idpCert', '');
      toast.success(t('settings.security.samlConfigSaved'));
    } catch {
      toast.error(t('settings.security.samlConfigSaveError'));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      await gqlMutate(SAML_DELETE_MUTATION);
      setConfig(null);
      setForm(DEFAULT_FORM);
      toast.success(t('settings.security.samlConfigRemoved'));
    } catch {
      toast.error(t('settings.security.samlConfigRemoveError'));
    } finally {
      setDeleting(false);
    }
  }

  function copyToClipboard(value: string, label: string) {
    void navigator.clipboard.writeText(value);
    toast.success(t('settings.security.copiedToClipboard', { label }));
  }

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      <PageHeader
        description={t('settings.security.description')}
        title={t('settings.security.title')}
      />
      <div className="mx-auto w-full max-w-2xl space-y-8 px-4 py-6 md:p-8">
        {/* SCIM Provisioning Section */}
        <section className="space-y-6 rounded-lg border border-border bg-card p-4 md:p-6">
          <div>
            <h2 className="font-medium">{t('settings.security.scimHeading')}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {t('settings.security.scimDescription')}
            </p>
          </div>

          {/* Base URL */}
          <div className="rounded-md bg-muted/50 p-4 space-y-3">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              {t('settings.security.scimBaseUrl')}
            </p>
            <ReadOnlyField
              label={t('settings.security.scimBaseUrlHint')}
              onCopy={() =>
                copyToClipboard(`${appUrl}/api/scim/v2`, t('settings.security.scimBaseUrl'))
              }
              value={`${appUrl}/api/scim/v2`}
            />
          </div>

          {/* Tokens */}
          <div className="space-y-3">
            <p className="text-sm font-medium">{t('settings.security.bearerTokens')}</p>

            {scimLoading ? (
              <RowsSkeleton count={3} />
            ) : scimFailed ? (
              <LoadError
                cause={scimCause}
                fallback={t('common.somethingWentWrong')}
                forbiddenMessage={t('settings.security.forbidden')}
                onRetry={() => void reloadScim()}
              />
            ) : (
              <>
                {scimTokens.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {t('settings.security.noActiveTokens')}
                  </p>
                ) : (
                  <div className="space-y-2">
                    {scimTokens.map(tok => (
                      <div
                        className="flex items-center justify-between rounded-md border border-border px-3 py-2"
                        key={tok.id}
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{tok.label}</p>
                          <p className="text-xs text-muted-foreground">
                            {t('settings.security.createdOn', {
                              date: formatDate(tok.createdAt),
                            })}
                            {tok.lastUsedAt
                              ? ` · ${t('settings.security.lastUsedOn', { date: formatDate(tok.lastUsedAt) })}`
                              : ` · ${t('settings.security.neverUsed')}`}
                          </p>
                        </div>
                        <Button
                          className="ml-3 shrink-0 border-danger/40 text-danger-subtle-foreground"
                          onClick={() => setPendingAction({ tokenId: tok.id, type: 'revokeScim' })}
                          size="xs"
                          type="button"
                          variant="outline"
                        >
                          {t('settings.security.revoke')}
                        </Button>
                      </div>
                    ))}
                  </div>
                )}

                {/* New token form */}
                {scimNewPlaintext ? (
                  <div className="rounded-md border border-warning/40 bg-warning-subtle p-3 space-y-2">
                    <p className="text-xs font-medium text-warning-subtle-foreground">
                      {t('settings.security.copyTokenNowWarning')}
                    </p>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 truncate rounded bg-card px-2 py-1 font-mono text-xs">
                        {scimNewPlaintext}
                      </code>
                      <button
                        aria-label={t('settings.security.copyToken')}
                        className={cn(
                          'shrink-0 text-muted-foreground hover:text-foreground',
                          TOUCH_TARGET,
                        )}
                        onClick={() =>
                          copyToClipboard(scimNewPlaintext, t('settings.security.scimTokenLabel'))
                        }
                        title={t('settings.security.copyToken')}
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
                      {t('settings.security.iHaveCopiedIt')}
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <Input
                      aria-label={t('settings.security.tokenLabel')}
                      className="flex-1"
                      onChange={e => setScimNewLabel(e.target.value)}
                      placeholder={t('settings.security.tokenLabelPlaceholder')}
                      value={scimNewLabel}
                    />
                    <Button
                      className="shrink-0"
                      disabled={scimCreating || !scimNewLabel.trim()}
                      onClick={handleScimCreate}
                      size="sm"
                      type="button"
                    >
                      {scimCreating
                        ? t('settings.security.creatingEllipsis')
                        : t('settings.security.createToken')}
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>
        </section>

        {/* SAML SSO Section */}
        <section className="space-y-6 rounded-lg border border-border bg-card p-4 md:p-6">
          <div>
            <h2 className="font-medium">{t('settings.security.samlHeading')}</h2>
            <p className="text-sm text-muted-foreground mt-1">
              {t('settings.security.samlDescription')}
            </p>
            {config && (
              <span className="inline-block mt-2 rounded-full bg-success-subtle px-2.5 py-0.5 text-xs font-medium text-success-subtle-foreground">
                {t('settings.security.configured')}
              </span>
            )}
          </div>

          {loading ? (
            <RowsSkeleton count={3} />
          ) : samlFailed ? (
            // A permission error means "you can't see this"; anything else is a
            // real failure. Either way the form stays hidden, so a configuration
            // that could not be read can never be silently overwritten.
            <LoadError
              cause={samlCause}
              fallback={t('common.somethingWentWrong')}
              forbiddenMessage={t('settings.security.forbidden')}
              onRetry={() => void reloadSaml()}
            />
          ) : (
            <>
              {/* SP (Service Provider) read-only info */}
              <div className="rounded-md bg-muted/50 p-4 space-y-3">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  {t('settings.security.serviceProviderDetails')}
                </p>
                <div className="space-y-2">
                  <ReadOnlyField
                    label={t('settings.security.spEntityIdLabel')}
                    onCopy={() =>
                      copyToClipboard(spEntityId, t('settings.security.metadataUrlLabel'))
                    }
                    value={metadataUrl}
                  />
                  <ReadOnlyField
                    label={t('settings.security.acsUrlLabel')}
                    onCopy={() => copyToClipboard(acsUrl, t('settings.security.acsUrlShortLabel'))}
                    value={acsUrl}
                  />
                </div>
              </div>

              {/* Configuration form */}
              <form className="space-y-4" noValidate onSubmit={handleSave}>
                <div>
                  <label className="mb-1 block text-sm font-medium" htmlFor="idpSsoUrl">
                    {t('settings.security.idpSsoUrl')} <span className="text-danger">*</span>
                  </label>
                  <Input
                    aria-describedby={errors.idpSsoUrl ? 'idpSsoUrl-error' : undefined}
                    aria-invalid={errors.idpSsoUrl ? true : undefined}
                    aria-required
                    id="idpSsoUrl"
                    onChange={e => setField('idpSsoUrl', e.target.value)}
                    placeholder="https://your-idp.example.com/sso/saml"
                    ref={ssoUrlRef}
                    type="url"
                    value={form.idpSsoUrl}
                  />
                  <FieldError id="idpSsoUrl-error" message={errors.idpSsoUrl} />
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium" htmlFor="idpEntityId">
                    {t('settings.security.idpEntityId')} <span className="text-danger">*</span>
                  </label>
                  <Input
                    aria-describedby={errors.idpEntityId ? 'idpEntityId-error' : undefined}
                    aria-invalid={errors.idpEntityId ? true : undefined}
                    aria-required
                    id="idpEntityId"
                    onChange={e => setField('idpEntityId', e.target.value)}
                    placeholder="https://your-idp.example.com/entity"
                    ref={entityIdRef}
                    value={form.idpEntityId}
                  />
                  <FieldError id="idpEntityId-error" message={errors.idpEntityId} />
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium" htmlFor="idpCert">
                    {t('settings.security.idpCertificate')}
                    {config ? (
                      ` — ${t('settings.security.leaveBlankToKeepExisting')}`
                    ) : (
                      <span className="text-danger"> *</span>
                    )}
                  </label>
                  <Textarea
                    aria-describedby={errors.idpCert ? 'idpCert-error' : undefined}
                    aria-invalid={errors.idpCert ? true : undefined}
                    aria-required={!config}
                    className="font-mono"
                    id="idpCert"
                    onChange={e => setField('idpCert', e.target.value)}
                    placeholder={'-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----'}
                    ref={certRef}
                    rows={4}
                    value={form.idpCert}
                  />
                  <FieldError id="idpCert-error" message={errors.idpCert} />
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium" htmlFor="idpMetadataUrl">
                    {t('settings.security.idpMetadataUrlOptional')}
                  </label>
                  <Input
                    id="idpMetadataUrl"
                    onChange={e => setField('idpMetadataUrl', e.target.value)}
                    placeholder="https://your-idp.example.com/metadata"
                    type="url"
                    value={form.idpMetadataUrl}
                  />
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-sm font-medium" htmlFor="emailAttribute">
                      {t('settings.security.emailAttribute')}
                    </label>
                    <Input
                      id="emailAttribute"
                      onChange={e => setField('emailAttribute', e.target.value)}
                      value={form.emailAttribute}
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium" htmlFor="nameAttribute">
                      {t('settings.security.nameAttribute')}
                    </label>
                    <Input
                      id="nameAttribute"
                      onChange={e => setField('nameAttribute', e.target.value)}
                      value={form.nameAttribute}
                    />
                  </div>
                </div>

                {/* Toggles */}
                <div className="space-y-3 pt-1">
                  <SettingToggleRow
                    checked={form.enabled}
                    description={t('settings.security.enableSamlSsoDescription')}
                    label={t('settings.security.enableSamlSso')}
                    onCheckedChange={v => setField('enabled', v)}
                  />
                  <SettingToggleRow
                    checked={form.jitProvisioning}
                    description={t('settings.security.jitProvisioningDescription')}
                    label={t('settings.security.jitProvisioning')}
                    onCheckedChange={v => setField('jitProvisioning', v)}
                  />
                  <SettingToggleRow
                    checked={form.ssoEnforced}
                    description={t('settings.security.enforceSsoDescription')}
                    label={t('settings.security.enforceSso')}
                    onCheckedChange={v => {
                      // Turning enforcement ON can lock every member out if the
                      // IdP details are wrong, so it is the one toggle that asks
                      // first. Turning it off is always safe.
                      if (v) {
                        setPendingAction({ type: 'enforceSso' });
                      } else {
                        setField('ssoEnforced', false);
                      }
                    }}
                  />
                </div>

                <div className="flex flex-wrap items-center gap-3 pt-2">
                  <Button disabled={saving} type="submit">
                    {saving ? t('common.saving') : t('settings.security.saveConfiguration')}
                  </Button>

                  {config && (
                    <>
                      <Button asChild variant="outline">
                        <a
                          href={`/api/auth/saml/initiate?org=${encodeURIComponent(orgKey)}&redirect=${encodeURIComponent(`/${orgKey}/settings/security`)}`}
                          rel="noreferrer"
                          target="_blank"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                          {t('settings.security.testSso')}
                        </a>
                      </Button>

                      <Button
                        className="border-danger/40 text-danger-subtle-foreground"
                        disabled={deleting}
                        onClick={() => setPendingAction({ type: 'removeSaml' })}
                        type="button"
                        variant="outline"
                      >
                        {deleting
                          ? t('settings.security.removingEllipsis')
                          : t('settings.security.remove')}
                      </Button>
                    </>
                  )}
                </div>
              </form>
            </>
          )}
        </section>

        <ConfirmDialog
          confirmLabel={
            pendingAction?.type === 'revokeScim'
              ? t('settings.security.revoke')
              : pendingAction?.type === 'enforceSso'
                ? t('settings.security.enforceSso')
                : t('settings.security.remove')
          }
          message={
            pendingAction?.type === 'revokeScim'
              ? t('settings.security.revokeScimTokenConfirm')
              : pendingAction?.type === 'enforceSso'
                ? t('settings.security.enforceSsoConfirm')
                : t('settings.security.removeSamlConfirm')
          }
          onCancel={() => setPendingAction(null)}
          onConfirm={() => {
            if (pendingAction?.type === 'revokeScim') {
              void handleScimRevoke(pendingAction.tokenId);
            } else if (pendingAction?.type === 'enforceSso') {
              setField('ssoEnforced', true);
            } else if (pendingAction?.type === 'removeSaml') {
              void handleDelete();
            }
            setPendingAction(null);
          }}
          open={pendingAction !== null}
          title={
            pendingAction?.type === 'revokeScim'
              ? t('settings.security.revoke')
              : pendingAction?.type === 'enforceSso'
                ? t('settings.security.enforceSsoTitle')
                : t('settings.security.remove')
          }
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) {
    return null;
  }
  return (
    <p className="mt-1 text-xs text-danger-subtle-foreground" id={id} role="alert">
      {message}
    </p>
  );
}
