import { CYCLE_FIELDS } from '@/lib/graphql-queries';

export const CYCLE_UNARCHIVE_MUTATION = `
  mutation CycleUnarchive($id: ID!) {
    cycleUnarchive(id: $id) { success lastSyncId cycle { ${CYCLE_FIELDS} } }
  }
`;

/** Archived rows are not in the bootstrap; `includeArchived` returns live + archived. */
export const ARCHIVED_CYCLES_QUERY = `
  query ArchivedCycles($teamId: ID!) {
    cycles(teamId: $teamId, includeArchived: true) { ${CYCLE_FIELDS} }
  }
`;
