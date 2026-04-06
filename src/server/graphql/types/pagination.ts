// Relay-style cursor pagination type definitions (SDL strings used in schema)

export const paginationTypeDefs = `
  type PageInfo {
    hasNextPage: Boolean!
    hasPreviousPage: Boolean!
    startCursor: String
    endCursor: String
  }
`;
