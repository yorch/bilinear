'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useTranslations } from '@/hooks/use-translations';
import { gql } from '@/lib/graphql';
import { ORGANIZATION_CREATE_MUTATION } from '@/lib/graphql-queries';

interface OrganizationCreateResult {
  accessToken: string;
  organization: { id: string; urlKey: string };
  refreshToken: string;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 63);
}

export function OnboardingForm() {
  const router = useRouter();
  const t = useTranslations();
  const [name, setName] = useState('');
  const [urlKey, setUrlKey] = useState('');
  const [urlKeyManuallyEdited, setUrlKeyManuallyEdited] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleNameChange(value: string) {
    setName(value);
    if (!urlKeyManuallyEdited) {
      setUrlKey(slugify(value));
    }
  }

  function handleUrlKeyChange(value: string) {
    setUrlKeyManuallyEdited(true);
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
        setError((data.errors[0] as { message: string }).message);
        return;
      }

      const { accessToken, refreshToken, organization } = (
        data.data as { organizationCreate: OrganizationCreateResult }
      ).organizationCreate;

      await fetch('/api/auth/session', {
        body: JSON.stringify({ accessToken, refreshToken }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      });

      router.push(`/${organization.urlKey}`);
    } catch {
      setError(t('common.somethingWentWrong'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-foreground-secondary" htmlFor="org-name">
          {t('auth.organizationName')}
        </label>
        <Input
          id="org-name"
          onChange={e => handleNameChange(e.target.value)}
          placeholder={t('auth.organizationNamePlaceholder')}
          type="text"
          value={name}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-foreground-secondary" htmlFor="url-key">
          {t('auth.workspaceUrl')}
        </label>
        <div className="flex items-center rounded-md border border-input transition-[border-color,box-shadow] duration-150 ease-crisp focus-within:border-ring focus-within:shadow-[0_0_0_3px_var(--brand-subtle)]">
          <span className="select-none pl-3 font-mono text-sm text-muted-foreground">
            issuetracker.app/
          </span>
          <input
            className="flex-1 bg-transparent px-1 py-1.5 font-mono text-sm text-foreground outline-none placeholder:text-muted-foreground"
            id="url-key"
            onChange={e => handleUrlKeyChange(e.target.value)}
            placeholder="acme"
            type="text"
            value={urlKey}
          />
        </div>
        {urlKey.length > 0 && urlKey.length < 3 && (
          <p className="text-xs text-warning-subtle-foreground">{t('auth.urlKeyMinLength')}</p>
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
    </form>
  );
}
