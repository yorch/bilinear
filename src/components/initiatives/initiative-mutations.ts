export const INITIATIVE_UPDATE_MUTATION = `
  mutation InitiativeUpdate($id: ID!, $input: InitiativeUpdateInput!) {
    initiativeUpdate(id: $id, input: $input) {
      success
      lastSyncId
      initiative { id status }
    }
  }
`;

export const INITIATIVE_UNARCHIVE_MUTATION = `
  mutation InitiativeUnarchive($id: ID!) { initiativeUnarchive(id: $id) { success lastSyncId } }
`;

export const ARCHIVED_INITIATIVES_QUERY = `
  query ArchivedInitiatives {
    initiatives(includeArchived: true) {
      id organizationId name description icon color status priority sortOrder
      targetDate startDate startDateResolution targetDateResolution progress
      ownerId creatorId parentId startedAt completedAt canceledAt
      createdAt updatedAt archivedAt
    }
  }
`;
