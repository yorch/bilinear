'use client';

import { KeyRound } from 'lucide-react';
import { useState } from 'react';
import { AuthField } from '@/components/auth/auth-field';
import { Button } from '@/components/ui/button';
import { useTranslations } from '@/hooks/use-translations';
import { finalizeUrlKey, sanitizeUrlKeyInput } from '@/lib/url-key';

/** The SAML entry point for a workspace, carrying the post-login destination. */
export function ssoInitiateUrl(urlKey: string, next: string | null): string {
  const params = new URLSearchParams({ org: finalizeUrlKey(urlKey) });
  if (next) {
    params.set('redirect', next);
  }
  return `/api/auth/saml/initiate?${params.toString()}`;
}

/**
 * "Continue with SSO". Always offered: whether a given workspace has SAML
 * enabled is not something a signed-out page may reveal (that would let anyone
 * enumerate workspaces), so the button cannot be conditional. Instead the
 * initiate route is probed without following its redirect — a redirect means
 * the IdP is ready and we go; anything else (unknown workspace, SAML off, not
 * configured — the route answers all three identically) gets one generic
 * message. Rendered OUTSIDE the email form: a <form> nested in a <form> is
 * invalid and the browser would natively submit the outer one.
 */
export function SsoEntry({ busy, next }: { busy: boolean; next: string | null }) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState('');
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (checking) {
      return;
    }
    if (finalizeUrlKey(key).length < 3) {
      setError(t('auth.sso.unavailable'));
      return;
    }
    setChecking(true);
    setError(null);
    const url = ssoInitiateUrl(key, next);
    try {
      const res = await fetch(`${url}&probe=1`, { redirect: 'manual' });
      if (res.type === 'opaqueredirect') {
        window.location.assign(url);
        return;
      }
      setError(t('auth.sso.unavailable'));
    } catch {
      setError(t('common.somethingWentWrong'));
    }
    setChecking(false);
  }

  if (!open) {
    return (
      <Button
        className="w-full"
        disabled={busy}
        onClick={() => setOpen(true)}
        type="button"
        variant="outline"
      >
        <KeyRound className="h-4 w-4" />
        {t('auth.sso.button')}
      </Button>
    );
  }

  return (
    <form className="flex flex-col gap-3" noValidate onSubmit={submit}>
      <AuthField
        autoCapitalize="none"
        autoComplete="off"
        autoFocus
        className="font-mono"
        error={error}
        hint={error ? undefined : t('auth.sso.hint')}
        id="sso-workspace"
        label={t('auth.workspaceUrl')}
        name="workspace"
        onChange={e => {
          setKey(sanitizeUrlKeyInput(e.target.value));
          setError(null);
        }}
        placeholder="acme"
        spellCheck={false}
        value={key}
      />
      <div className="flex gap-2">
        <Button className="flex-1" disabled={busy || checking || !key} type="submit">
          {checking ? t('auth.sso.checking') : t('auth.sso.continue')}
        </Button>
        <Button
          disabled={checking}
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
          type="button"
          variant="ghost"
        >
          {t('common.cancel')}
        </Button>
      </div>
    </form>
  );
}
