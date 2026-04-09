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
    organizationId: ID!
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
    defaultIssueStateId: ID
    parentId: ID
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
    projectId: ID
    projectMilestoneId: ID
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
    project: Project
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
    projectId: String
    projectMilestoneId: String
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
    projectId: String
    projectMilestoneId: String
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

  input OrganizationCreateInput {
    name: String!
    urlKey: String!
  }

  type OrganizationCreatePayload {
    success: Boolean!
    organization: Organization!
    accessToken: String!
    refreshToken: String!
    expiresIn: Int!
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

  enum TeamDeleteIssueAction {
    DELETE
    MOVE
  }

  input TeamDeleteInput {
    issueAction: TeamDeleteIssueAction!
    moveToTeamId: String
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

  type Project {
    id: ID!
    name: String!
    slugId: String!
    description: String!
    content: String
    icon: String
    color: String!
    statusType: String!
    statusName: String
    health: String
    healthUpdatedAt: DateTime
    priority: Int!
    progress: Float!
    scope: Float!
    startDate: Date
    targetDate: Date
    startDateResolution: String
    targetDateResolution: String
    lead: User
    creator: User
    startedAt: DateTime
    completedAt: DateTime
    canceledAt: DateTime
    archivedAt: DateTime
    createdAt: DateTime!
    updatedAt: DateTime!
    issues: [Issue!]!
    teams: [Team!]!
    members: [User!]!
    milestones: [ProjectMilestone!]!
    updates: [ProjectUpdate!]!
  }

  type ProjectMilestone {
    id: ID!
    projectId: ID!
    name: String!
    description: String
    targetDate: Date
    sortOrder: Float!
    createdAt: DateTime!
    updatedAt: DateTime!
    archivedAt: DateTime
  }

  type ProjectUpdate {
    id: ID!
    projectId: ID!
    body: String!
    bodyData: JSON!
    health: String!
    user: User!
    editedAt: DateTime
    createdAt: DateTime!
    updatedAt: DateTime!
    archivedAt: DateTime
  }

  type ProjectEdge {
    node: Project!
    cursor: String!
  }

  type ProjectConnection {
    edges: [ProjectEdge!]!
    nodes: [Project!]!
    pageInfo: PageInfo!
    totalCount: Int!
  }

  type ProjectPayload {
    success: Boolean!
    project: Project
    lastSyncId: String!
  }

  type ProjectMilestonePayload {
    success: Boolean!
    projectMilestone: ProjectMilestone
    lastSyncId: String!
  }

  type ProjectUpdatePayload {
    success: Boolean!
    projectUpdate: ProjectUpdate
    lastSyncId: String!
  }

  input ProjectCreateInput {
    id: String
    name: String!
    description: String
    icon: String
    color: String
    statusType: String
    leadId: String
    startDate: Date
    targetDate: Date
    startDateResolution: String
    targetDateResolution: String
    teamIds: [String!]!
    memberIds: [String!]
  }

  input ProjectUpdateInput {
    name: String
    description: String
    content: String
    icon: String
    color: String
    statusType: String
    health: String
    leadId: String
    startDate: Date
    targetDate: Date
    startDateResolution: String
    targetDateResolution: String
    priority: Int
  }

  input ProjectMilestoneCreateInput {
    id: String
    projectId: String!
    name: String!
    description: String
    targetDate: Date
    sortOrder: Float
  }

  input ProjectMilestoneUpdateInput {
    name: String
    description: String
    targetDate: Date
    sortOrder: Float
  }

  input ProjectUpdateCreateInput {
    id: String
    projectId: String!
    body: String!
    bodyData: JSON!
    health: String!
  }

  input ProjectUpdateUpdateInput {
    body: String
    bodyData: JSON
    health: String
  }

  input ProjectFilter {
    statusType: String
    health: String
    leadId: String
  }

  scalar JSON

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
    project(id: ID!): Project!
    projects(
      filter: ProjectFilter
      first: Int
      after: String
      includeArchived: Boolean
    ): ProjectConnection!
  }

  type Mutation {
    emailLogin(input: EmailLoginInput!): EmailLoginPayload!
    emailVerify(input: EmailVerifyInput!): AuthPayload!
    googleAuthExchange(code: String!, redirectUri: String!): AuthPayload!
    tokenRefresh(refreshToken: String!): AuthPayload!
    logout: LogoutPayload!

    organizationCreate(input: OrganizationCreateInput!): OrganizationCreatePayload!

    teamCreate(input: TeamCreateInput!): TeamPayload!
    teamUpdate(id: ID!, input: TeamUpdateInput!): TeamPayload!
    teamDelete(id: ID!, input: TeamDeleteInput!): DeletePayload!

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

    projectCreate(input: ProjectCreateInput!): ProjectPayload!
    projectUpdate(id: ID!, input: ProjectUpdateInput!): ProjectPayload!
    projectArchive(id: ID!): ProjectPayload!
    projectDelete(id: ID!): DeletePayload!

    projectAddTeam(projectId: ID!, teamId: ID!): ProjectPayload!
    projectRemoveTeam(projectId: ID!, teamId: ID!): ProjectPayload!
    projectAddMember(projectId: ID!, userId: ID!): ProjectPayload!
    projectRemoveMember(projectId: ID!, userId: ID!): ProjectPayload!

    projectMilestoneCreate(input: ProjectMilestoneCreateInput!): ProjectMilestonePayload!
    projectMilestoneUpdate(id: ID!, input: ProjectMilestoneUpdateInput!): ProjectMilestonePayload!
    projectMilestoneDelete(id: ID!): DeletePayload!

    projectUpdateCreate(input: ProjectUpdateCreateInput!): ProjectUpdatePayload!
    projectUpdateUpdate(id: ID!, input: ProjectUpdateUpdateInput!): ProjectUpdatePayload!
    projectUpdateDelete(id: ID!): DeletePayload!
  }
`;
