'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
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
      setError('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300" htmlFor="org-name">
          Organization name
        </label>
        <input
          className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:placeholder:text-zinc-600 dark:focus:ring-zinc-100"
          id="org-name"
          onChange={e => handleNameChange(e.target.value)}
          placeholder="Acme Inc."
          type="text"
          value={name}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300" htmlFor="url-key">
          Workspace URL
        </label>
        <div className="flex items-center rounded-md border border-zinc-300 bg-white dark:border-zinc-700 dark:bg-zinc-900 focus-within:ring-2 focus-within:ring-zinc-900 dark:focus-within:ring-zinc-100">
          <span className="pl-3 text-sm text-zinc-400 dark:text-zinc-600 select-none">
            issuetracker.app/
          </span>
          <input
            className="flex-1 bg-transparent px-1 py-2 text-zinc-900 placeholder:text-zinc-400 focus:outline-none dark:text-zinc-50 dark:placeholder:text-zinc-600"
            id="url-key"
            onChange={e => handleUrlKeyChange(e.target.value)}
            placeholder="acme"
            type="text"
            value={urlKey}
          />
        </div>
        {urlKey.length > 0 && urlKey.length < 3 && (
          <p className="text-xs text-amber-600 dark:text-amber-400">
            Must be at least 3 characters
          </p>
        )}
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <Button
        className="w-full"
        disabled={loading || !name.trim() || urlKey.length < 3}
        type="submit"
      >
        {loading ? 'Creating workspace…' : 'Create workspace'}
      </Button>
    </form>
  );
}
