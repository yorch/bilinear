import { paginationTypeDefs } from './types/pagination';

export const typeDefs = `
  scalar DateTime
  scalar UUID
  scalar Date

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
    issues: [Issue!]!
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

  type IssueLabel {
    id: ID!
    name: String!
    color: String!
    description: String
    isGroup: Boolean!
    organizationId: ID!
    teamId: ID
    parentId: ID
    parent: IssueLabel
    children: [IssueLabel!]!
    createdAt: DateTime!
    updatedAt: DateTime!
    archivedAt: DateTime
  }

  type Issue {
    id: ID!
    number: Int!
    identifier: String!
    title: String!
    description: String
    priority: Int!
    estimate: Float
    dueDate: Date
    sortOrder: Float!
    trashed: Boolean!
    teamId: ID!
    stateId: ID!
    assigneeId: ID
    creatorId: ID
    parentId: ID
    organizationId: ID!
    branchName: String
    startedAt: DateTime
    completedAt: DateTime
    canceledAt: DateTime
    archivedAt: DateTime
    createdAt: DateTime!
    updatedAt: DateTime!
    team: Team!
    state: WorkflowState!
    assignee: User
    creator: User
    parent: Issue
    children: [Issue!]!
    labels: [IssueLabel!]!
  }

  type IssueEdge {
    node: Issue!
    cursor: String!
  }

  type IssueConnection {
    edges: [IssueEdge!]!
    nodes: [Issue!]!
    pageInfo: PageInfo!
    totalCount: Int!
  }

  type IssueLabelEdge {
    node: IssueLabel!
    cursor: String!
  }

  type IssueLabelConnection {
    edges: [IssueLabelEdge!]!
    nodes: [IssueLabel!]!
    pageInfo: PageInfo!
    totalCount: Int!
  }

  type IssuePayload {
    success: Boolean!
    issue: Issue
    lastSyncId: String!
  }

  type IssueLabelPayload {
    success: Boolean!
    issueLabel: IssueLabel
    lastSyncId: String!
  }

  input IssueCreateInput {
    id: String
    title: String!
    description: String
    teamId: String!
    stateId: String
    assigneeId: String
    priority: Int
    estimate: Float
    dueDate: Date
    labelIds: [String!]
    parentId: String
    sortOrder: Float
  }

  input IssueUpdateInput {
    title: String
    description: String
    stateId: String
    assigneeId: String
    priority: Int
    estimate: Float
    dueDate: Date
    labelIds: [String!]
    parentId: String
    sortOrder: Float
    prioritySortOrder: Float
    trashed: Boolean
  }

  input IssueFilter {
    teamId: String
    stateId: String
    assigneeId: String
    priority: Int
    trashed: Boolean
  }

  input IssueLabelCreateInput {
    id: String
    name: String!
    color: String!
    description: String
    teamId: String
    parentId: String
    isGroup: Boolean
  }

  input IssueLabelUpdateInput {
    name: String
    color: String
    description: String
    parentId: String
  }

  type TeamPayload {
    success: Boolean!
    team: Team
    lastSyncId: String!
  }

  type TeamMembershipPayload {
    success: Boolean!
    teamMembership: TeamMembership
    lastSyncId: String!
  }

  type WorkflowStatePayload {
    success: Boolean!
    workflowState: WorkflowState
    lastSyncId: String!
  }

  type DeletePayload {
    success: Boolean!
    lastSyncId: String!
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
    issue(id: ID!): Issue!
    issues(
      filter: IssueFilter
      first: Int
      after: String
      last: Int
      before: String
      includeArchived: Boolean
    ): IssueConnection!
    searchIssues(
      query: String!
      first: Int
      includeArchived: Boolean
    ): IssueConnection!
    labels(teamId: String): IssueLabelConnection!
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

    issueCreate(input: IssueCreateInput!): IssuePayload!
    issueUpdate(id: ID!, input: IssueUpdateInput!): IssuePayload!
    issueArchive(id: ID!): IssuePayload!
    issueUnarchive(id: ID!): IssuePayload!
    issueDelete(id: ID!): DeletePayload!

    issueLabelCreate(input: IssueLabelCreateInput!): IssueLabelPayload!
    issueLabelUpdate(id: ID!, input: IssueLabelUpdateInput!): IssueLabelPayload!
    issueLabelArchive(id: ID!): IssueLabelPayload!
  }
`;
