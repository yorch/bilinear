/**
 * Minimal fetch wrapper for GraphQL queries/mutations.
 * Use this in client components instead of Apollo Client.
 */
export async function gql(
  query: string,
  variables: Record<string, unknown> = {},
) {
  const res = await fetch('/api/graphql', {
    body: JSON.stringify({ query, variables }),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  });
  if (!res.ok) {
    throw new Error(`GraphQL request failed: ${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<{
    data?: Record<string, unknown>;
    errors?: unknown[];
  }>;
}
