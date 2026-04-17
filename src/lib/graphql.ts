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
