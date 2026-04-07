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

  type Team {
    id: ID!
    name: String!
    key: String!
    displayName: String!
    description: String
    icon: String
    color: String
    private: Boolean!
    timezone: String!
    cyclesEnabled: Boolean!
    issueEstimationType: String!
    triageEnabled: Boolean!
    issueCount: Int!
    organization: Organization!
    parent: Team
    children: [Team!]!
    states: [WorkflowState!]!
    members: [TeamMembership!]!
    createdAt: DateTime!
    updatedAt: DateTime!
    archivedAt: DateTime
  }

  type TeamMembership {
    id: ID!
    team: Team!
    user: User!
    owner: Boolean!
    sortOrder: Float!
    createdAt: DateTime!
    updatedAt: DateTime!
  }

  type WorkflowState {
    id: ID!
    name: String!
    color: String!
    description: String
    type: String!
    position: Float!
    team: Team!
    createdAt: DateTime!
    updatedAt: DateTime!
    archivedAt: DateTime
  }

  type TeamPayload {
    success: Boolean!
    team: Team
    lastSyncId: Int!
  }

  type TeamMembershipPayload {
    success: Boolean!
    teamMembership: TeamMembership
    lastSyncId: Int!
  }

  type WorkflowStatePayload {
    success: Boolean!
    workflowState: WorkflowState
    lastSyncId: Int!
  }

  type DeletePayload {
    success: Boolean!
    lastSyncId: Int!
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

  input TeamCreateInput {
    id: String
    name: String!
    key: String!
    description: String
    icon: String
    color: String
    private: Boolean
    timezone: String
    triageEnabled: Boolean
  }

  input TeamUpdateInput {
    name: String
    description: String
    icon: String
    color: String
    private: Boolean
    timezone: String
    cyclesEnabled: Boolean
    cycleDuration: Int
    issueEstimationType: String
    triageEnabled: Boolean
    autoClosePeriod: Int
    autoArchivePeriod: Int
  }

  input TeamMembershipCreateInput {
    teamId: String!
    userId: String!
    isOwner: Boolean
  }

  input TeamMembershipUpdateInput {
    isOwner: Boolean
    sortOrder: Float
  }

  input WorkflowStateCreateInput {
    id: String
    teamId: String!
    name: String!
    color: String!
    type: String!
    position: Float
    description: String
  }

  input WorkflowStateUpdateInput {
    name: String
    color: String
    position: Float
    description: String
  }

  type Query {
    viewer: User!
    organization: Organization!
    team(id: ID!): Team!
    teams: [Team!]!
  }

  type Mutation {
    emailLogin(input: EmailLoginInput!): EmailLoginPayload!
    emailVerify(input: EmailVerifyInput!): AuthPayload!
    googleAuthExchange(code: String!, redirectUri: String!): AuthPayload!
    tokenRefresh(refreshToken: String!): AuthPayload!
    logout: LogoutPayload!

    teamCreate(input: TeamCreateInput!): TeamPayload!
    teamUpdate(id: ID!, input: TeamUpdateInput!): TeamPayload!
    teamDelete(id: ID!): DeletePayload!

    teamMembershipCreate(input: TeamMembershipCreateInput!): TeamMembershipPayload!
    teamMembershipUpdate(id: ID!, input: TeamMembershipUpdateInput!): TeamMembershipPayload!
    teamMembershipDelete(id: ID!): DeletePayload!

    workflowStateCreate(input: WorkflowStateCreateInput!): WorkflowStatePayload!
    workflowStateUpdate(id: ID!, input: WorkflowStateUpdateInput!): WorkflowStatePayload!
    workflowStateArchive(id: ID!): WorkflowStatePayload!
  }
`;
