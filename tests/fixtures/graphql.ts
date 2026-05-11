import type { Page } from '@playwright/test';

interface GqlError {
  extensions?: { code?: string };
  message?: string;
}

export interface GqlResponse<T = unknown> {
  data?: T;
  errors?: GqlError[];
}

/**
 * POST a GraphQL query/mutation from the page's browser context so the
 * existing httpOnly auth cookies attach automatically. Returns the parsed
 * response — callers decide whether to read `data` or assert on `errors`.
 */
export function gqlInPage<T = unknown>(
  page: Page,
  query: string,
  variables?: Record<string, unknown>,
): Promise<GqlResponse<T>> {
  return page.evaluate(
    async ({ query, variables }) => {
      const resp = await fetch('/api/graphql', {
        body: JSON.stringify({ query, variables }),
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      });
      return (await resp.json()) as GqlResponse<unknown>;
    },
    { query, variables },
  ) as Promise<GqlResponse<T>>;
}

export async function getTeamIdByKey(page: Page, teamKey: string): Promise<string | null> {
  const result = await gqlInPage<{ teams: Array<{ id: string; key: string }> }>(
    page,
    `{ teams { id key } }`,
  );
  return result?.data?.teams?.find(t => t.key === teamKey)?.id ?? null;
}
