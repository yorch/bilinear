import { paginationTypeDefs } from './types/pagination';

export const typeDefs = `
  scalar DateTime
  scalar UUID

  ${paginationTypeDefs}

  type User {
    id: ID!
    name: String!
    displayName: String!
    email: String!
    initials: String!
    avatarUrl: String
    avatarBackgroundColor: String!
    active: Boolean!
    isMe: Boolean!
    timezone: String
    lastSeen: DateTime
    statusEmoji: String
    statusLabel: String
    statusUntilAt: DateTime
    createdAt: DateTime!
    updatedAt: DateTime!
  }

  type Organization {
    id: ID!
    name: String!
    urlKey: String!
    logoUrl: String
    dataRegion: String!
    roadmapEnabled: Boolean!
    createdAt: DateTime!
    updatedAt: DateTime!
    archivedAt: DateTime
  }

  type EmailLoginPayload {
    success: Boolean!
  }

  type AuthPayload {
    success: Boolean!
    accessToken: String!
    refreshToken: String!
    expiresIn: Int!
    user: User!
  }

  type LogoutPayload {
    success: Boolean!
  }

  input EmailLoginInput {
    email: String!
  }

  input EmailVerifyInput {
    email: String!
    code: String!
  }

  type Query {
    viewer: User!
    organization: Organization!
  }

  type Mutation {
    emailLogin(input: EmailLoginInput!): EmailLoginPayload!
    emailVerify(input: EmailVerifyInput!): AuthPayload!
    googleAuthExchange(code: String!, redirectUri: String!): AuthPayload!
    tokenRefresh(refreshToken: String!): AuthPayload!
    logout: LogoutPayload!
  }
`;
