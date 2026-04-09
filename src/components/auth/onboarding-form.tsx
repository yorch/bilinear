'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';

const ORGANIZATION_CREATE_MUTATION = `
  mutation OrganizationCreate($input: OrganizationCreateInput!) {
    organizationCreate(input: $input) {
      success
      accessToken
      refreshToken
      expiresIn
      organization {
        id
        name
        urlKey
      }
    }
  }
`;

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
      const res = await fetch('/api/graphql', {
        body: JSON.stringify({
          query: ORGANIZATION_CREATE_MUTATION,
          variables: { input: { name: name.trim(), urlKey } },
        }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      });

      const data = await res.json();

      if (data.errors?.length) {
        setError(data.errors[0].message);
        return;
      }

      const { accessToken, refreshToken, organization } =
        data.data.organizationCreate;

      // Update session cookies with new tokens that include orgId
      await fetch('/api/auth/session', {
        body: JSON.stringify({ accessToken, refreshToken }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      });

      router.push(`/${organization.id}`);
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="org-name"
          className="text-sm font-medium text-zinc-700 dark:text-zinc-300"
        >
          Organization name
        </label>
        <input
          id="org-name"
          type="text"
          value={name}
          onChange={e => handleNameChange(e.target.value)}
          placeholder="Acme Inc."
          className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:placeholder:text-zinc-600 dark:focus:ring-zinc-100"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="url-key"
          className="text-sm font-medium text-zinc-700 dark:text-zinc-300"
        >
          Workspace URL
        </label>
        <div className="flex items-center rounded-md border border-zinc-300 bg-white dark:border-zinc-700 dark:bg-zinc-900 focus-within:ring-2 focus-within:ring-zinc-900 dark:focus-within:ring-zinc-100">
          <span className="pl-3 text-sm text-zinc-400 dark:text-zinc-600 select-none">
            issuetracker.app/
          </span>
          <input
            id="url-key"
            type="text"
            value={urlKey}
            onChange={e => handleUrlKeyChange(e.target.value)}
            placeholder="acme"
            className="flex-1 bg-transparent px-1 py-2 text-zinc-900 placeholder:text-zinc-400 focus:outline-none dark:text-zinc-50 dark:placeholder:text-zinc-600"
          />
        </div>
        {urlKey.length > 0 && urlKey.length < 3 && (
          <p className="text-xs text-amber-600 dark:text-amber-400">
            Must be at least 3 characters
          </p>
        )}
      </div>

      {error && (
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      )}

      <Button
        type="submit"
        disabled={loading || !name.trim() || urlKey.length < 3}
        className="w-full"
      >
        {loading ? 'Creating workspace…' : 'Create workspace'}
      </Button>
    </form>
  );
}
