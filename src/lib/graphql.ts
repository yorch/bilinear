/**
 * Minimal fetch wrapper for GraphQL queries/mutations.
 * Use this in client components instead of Apollo Client.
 */
export async function gql(query: string, variables: Record<string, unknown> = {}) {
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

/**
 * `gql()` that throws on a GraphQL-level failure instead of returning it.
 *
 * `/api/graphql` answers **HTTP 200** for every GraphQL error — validation
 * failures, UNAUTHENTICATED on an expired session, FORBIDDEN, resolver faults —
 * so `gql()` resolves normally with `data` undefined (or, for a nullable root
 * field, present-but-null alongside `errors`). Call sites that only read
 * `res.data` therefore cannot distinguish "the request failed" from "there is
 * genuinely nothing here", and render an empty list or a success toast for a
 * request the server rejected.
 *
 * Use this for every read, and for any write whose success is reported to the
 * user. `gqlQuery` unwraps `data[key]` so the caller gets the payload directly;
 * `gqlMutate` returns the whole `data` object for multi-field payloads.
 */
export async function gqlMutate(
  query: string,
  variables: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const res = await gql(query, variables);
  if (res.errors?.length) {
    throw new Error((res.errors[0] as { message?: string })?.message ?? 'Request failed');
  }
  return res.data ?? {};
}

export async function gqlQuery<T>(
  query: string,
  variables: Record<string, unknown> = {},
  key?: string,
): Promise<T> {
  const data = await gqlMutate(query, variables);
  return (key ? data[key] : data) as T;
}

const DOCUMENT_FIELDS = `
  id organizationId teamId projectId creatorId parentId
  title content icon sortOrder
  createdAt updatedAt archivedAt
`;

export async function createDocument(input: {
  id?: string;
  teamId?: string;
  projectId?: string;
  parentId?: string;
  title: string;
  content?: string;
  icon?: string;
}) {
  return gql(
    `mutation DocumentCreate($input: DocumentCreateInput!) {
      documentCreate(input: $input) {
        success
        lastSyncId
        document { ${DOCUMENT_FIELDS} }
      }
    }`,
    { input },
  );
}

export async function updateDocument(
  id: string,
  input: {
    title?: string;
    content?: string;
    icon?: string;
    sortOrder?: number;
    parentId?: string | null;
  },
) {
  return gql(
    `mutation DocumentUpdate($id: ID!, $input: DocumentUpdateInput!) {
      documentUpdate(id: $id, input: $input) {
        success
        lastSyncId
        document { ${DOCUMENT_FIELDS} }
      }
    }`,
    { id, input },
  );
}

export async function archiveDocument(id: string) {
  return gql(
    `mutation DocumentArchive($id: ID!) {
      documentArchive(id: $id) {
        success
        lastSyncId
        document { ${DOCUMENT_FIELDS} }
      }
    }`,
    { id },
  );
}

export async function deleteDocument(id: string) {
  return gql(
    `mutation DocumentDelete($id: ID!) {
      documentDelete(id: $id) {
        success
        lastSyncId
      }
    }`,
    { id },
  );
}
