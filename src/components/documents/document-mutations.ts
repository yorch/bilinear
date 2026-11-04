/**
 * Shared by the editor's debounced saves and the list's row actions — one
 * operation, one selection set, so the enqueued TransactionQueue payload is
 * identical everywhere.
 */
export const DOCUMENT_UPDATE_MUTATION = `mutation DocumentUpdate($id: ID!, $input: DocumentUpdateInput!) {
  documentUpdate(id: $id, input: $input) {
    success
    lastSyncId
    document { id title content updatedAt }
  }
}`;

export const DOCUMENT_ARCHIVE_MUTATION = `mutation ($id: ID!) { documentArchive(id: $id) { success } }`;
export const DOCUMENT_DELETE_MUTATION = `mutation ($id: ID!) { documentDelete(id: $id) { success } }`;
