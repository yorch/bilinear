'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { AuthField } from '@/components/auth/auth-field';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/use-auth';
import { useTranslations } from '@/hooks/use-translations';
import { installSessionCookies } from '@/lib/auth-session';
import { gql } from '@/lib/graphql';
import { ORGANIZATION_CREATE_MUTATION } from '@/lib/graphql-queries';

interface OrganizationCreateResult {
  accessToken: string;
  organization: { id: string; urlKey: string };
  refreshToken: string;
}

export function slugify(value: string): string {
  return (
    value
      // Decompose accents first so "Ünïcode" becomes "unicode" rather than
      // losing the letters the [^a-z0-9] pass would otherwise strip whole.
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 63)
  );
}

export function OnboardingForm({ host }: { host: string }) {
  const router = useRouter();
  const { logout, user } = useAuth();
  const t = useTranslations();
  const [name, setName] = useState('');
  const [urlKey, setUrlKey] = useState('');
  const [urlKeyManuallyEdited, setUrlKeyManuallyEdited] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [takenKey, setTakenKey] = useState<string | null>(null);

  function handleNameChange(value: string) {
    setName(value);
    if (!urlKeyManuallyEdited) {
      setTakenKey(null);
      setUrlKey(slugify(value));
    }
  }

  function handleUrlKeyChange(value: string) {
    setUrlKeyManuallyEdited(true);
    setTakenKey(null);
    setUrlKey(slugify(value));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!name.trim() || urlKey.length < 3) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const data = await gql(ORGANIZATION_CREATE_MUTATION, {
        input: { name: name.trim(), urlKey },
      });

      if (data.errors?.length) {
        const first = data.errors[0] as {
          extensions?: { reason?: string };
          message: string;
        };
        // A taken key is a field problem, not a form-level failure: show it
        // under the URL input with a free alternative to click.
        if (first.extensions?.reason === 'URL_KEY_TAKEN') {
          setTakenKey(urlKey);
          return;
        }
        setError(first.message);
        return;
      }

      const { accessToken, refreshToken, organization } = (
        data.data as { organizationCreate: OrganizationCreateResult }
      ).organizationCreate;

      if (!(await installSessionCookies({ accessToken, refreshToken }))) {
        setError(t('auth.failedToEstablishSession'));
        return;
      }

      router.push(`/${organization.urlKey}`);
    } catch {
      setError(t('common.somethingWentWrong'));
    } finally {
      setLoading(false);
    }
  }

  const urlTaken = takenKey !== null && takenKey === urlKey;
  const suggestion = urlTaken ? `${urlKey}-2`.slice(0, 63) : null;

  return (
    <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
      <AuthField
        autoComplete="organization"
        autoFocus
        id="org-name"
        label={t('auth.organizationName')}
        name="organization"
        onChange={e => handleNameChange(e.target.value)}
        placeholder={t('auth.organizationNamePlaceholder')}
        required
        value={name}
      />

      <div className="flex flex-col gap-1.5">
        <AuthField
          autoCapitalize="none"
          autoComplete="off"
          className="font-mono"
          error={
            urlTaken
              ? t('auth.urlKeyTaken')
              : urlKey.length > 0 && urlKey.length < 3
                ? t('auth.urlKeyMinLength')
                : null
          }
          id="url-key"
          label={t('auth.workspaceUrl')}
          leading={`${host}/`}
          name="urlKey"
          onChange={e => handleUrlKeyChange(e.target.value)}
          placeholder="acme"
          required
          spellCheck={false}
          value={urlKey}
        />
        {suggestion && (
          <Button
            className="h-auto justify-start p-0 text-xs"
            onClick={() => {
              setUrlKeyManuallyEdited(true);
              setTakenKey(null);
              setUrlKey(suggestion);
            }}
            type="button"
            variant="link"
          >
            {t('auth.urlKeyTakenSuggestion', { suggestion })}
          </Button>
        )}
      </div>

      {error && (
        <p className="text-sm text-danger-subtle-foreground" role="alert">
          {error}
        </p>
      )}

      <Button
        className="w-full"
        disabled={loading || !name.trim() || urlKey.length < 3}
        type="submit"
      >
        {loading ? t('auth.creatingWorkspace') : t('auth.createWorkspaceButton')}
      </Button>

      <Button
        className="h-auto whitespace-normal text-center"
        onClick={() => void logout()}
        type="button"
        variant="link"
      >
        {user ? `${t('auth.signOutSwitch')} (${user.email})` : t('auth.signOutSwitch')}
      </Button>
    </form>
  );
}
