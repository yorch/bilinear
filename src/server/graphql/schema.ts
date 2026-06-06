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
    emailNotificationsEnabled: Boolean!
    calendarFeedUrl: String
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

  enum TeamMemberRole {
    admin
    member
    guest
  }

  type TeamMembership {
    id: ID!
    team: Team!
    user: User!
    owner: Boolean!
    role: TeamMemberRole!
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
    startDate: Date
    dueDate: Date
    sortOrder: Float!
    prioritySortOrder: Float!
    trashed: Boolean!
    teamId: ID!
    stateId: ID!
    assigneeId: ID
    creatorId: ID
    parentId: ID
    projectId: ID
    projectMilestoneId: ID
    cycleId: ID
    organizationId: ID!
    branchName: String
    snoozedById: ID
    snoozedUntilAt: DateTime
    pullRequests: [GitHubPullRequest!]!
    cycle: Cycle
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
    customFieldValues: [CustomFieldValue!]!
    files: [File!]!
    reactions: [IssueReaction!]!
  }

  type IssueBulkUpdatePayload {
    success: Boolean!
    issues: [Issue!]!
    lastSyncId: String!
  }

  type IssueReaction {
    id: ID!
    issueId: ID!
    userId: ID!
    emoji: String!
    user: User!
    createdAt: DateTime!
  }

  type IssueReactionPayload {
    success: Boolean!
    reaction: IssueReaction
    lastSyncId: String!
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
    startDate: Date
    dueDate: Date
    labelIds: [String!]
    parentId: String
    sortOrder: Float
    projectId: String
    projectMilestoneId: String
    cycleId: String
  }

  input IssueUpdateInput {
    title: String
    description: String
    stateId: String
    assigneeId: String
    priority: Int
    estimate: Float
    startDate: Date
    dueDate: Date
    labelIds: [String!]
    parentId: String
    sortOrder: Float
    prioritySortOrder: Float
    trashed: Boolean
    projectId: String
    projectMilestoneId: String
    cycleId: String
  }

  input IssueFilter {
    teamId: String
    stateId: String
    assigneeId: String
    priority: Int
    trashed: Boolean
    """
    Include snoozed issues that haven't woken up yet. Default false —
    snoozed issues are hidden from lists until now() reaches snoozedUntilAt.
    """
    includeSnoozed: Boolean
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

  type BasicPayload {
    success: Boolean!
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
    parentId: String
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
    parentId: String
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
    role: TeamMemberRole
  }

  input TeamMembershipUpdateInput {
    isOwner: Boolean
    role: TeamMemberRole
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
    roadmapVisible: Boolean!
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
    progressHistory: [ProgressHistoryPoint!]!
  }

  type ProgressHistoryPoint {
    """UTC date (YYYY-MM-DD)"""
    date: String!
    """Number of completed issues on that date"""
    completedIssueCount: Int!
    """Total issue count (scope, by count) on that date"""
    issueCount: Int!
    """Sum of estimates for completed issues on that date"""
    completedScope: Float!
    """Sum of estimates for all in-scope issues on that date"""
    scope: Float!
  }

  type PublicRoadmap {
    id: ID!
    organizationId: ID!
    slug: String!
    enabled: Boolean!
    title: String!
    description: String
    hasPassword: Boolean!
    createdAt: DateTime!
    updatedAt: DateTime!
  }

  type RoadmapProject {
    id: ID!
    name: String!
    icon: String
    color: String!
    statusType: String!
    statusName: String
    health: String
    targetDate: Date
    progress: Float!
    milestoneCount: Int!
    completedMilestoneCount: Int!
  }

  type PublicRoadmapPage {
    roadmap: PublicRoadmap!
    projects: [RoadmapProject!]!
    requiresPassword: Boolean!
  }

  type PublicRoadmapUpsertResult {
    success: Boolean!
    roadmap: PublicRoadmap
    lastSyncId: String!
  }

  input PublicRoadmapUpsertInput {
    slug: String
    enabled: Boolean
    title: String
    description: String
    password: String
  }

  type ProjectMutationResult {
    success: Boolean!
    project: Project
    lastSyncId: String!
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

  type Cycle {
    id: ID!
    number: Int!
    name: String
    description: String
    startsAt: DateTime!
    endsAt: DateTime!
    completedAt: DateTime
    progress: Float!
    scope: Float!
    carryoverCount: Int!
    teamId: ID!
    organizationId: ID!
    team: Team!
    issues: [Issue!]!
    archivedAt: DateTime
    createdAt: DateTime!
    updatedAt: DateTime!
  }

  type Notification {
    id: ID!
    organizationId: ID!
    userId: ID!
    issueId: ID
    actorId: ID
    type: String!
    data: JSON!
    read: Boolean!
    readAt: DateTime
    snoozedUntilAt: DateTime
    actor: User
    issue: Issue
    createdAt: DateTime!
    updatedAt: DateTime!
  }

  type NotificationPayload {
    success: Boolean!
    notification: Notification
    lastSyncId: String!
  }

  type IssueActivity {
    id: ID!
    issueId: ID!
    actorId: ID
    field: String!
    oldValue: String
    newValue: String
    actor: User
    createdAt: DateTime!
  }

  type CyclePayload {
    success: Boolean!
    cycle: Cycle
    lastSyncId: String!
  }

  type CycleRolloverPayload {
    success: Boolean!
    lastSyncId: String!
    movedCount: Int!
    nextCycleId: ID
  }

  type CycleVelocityCycle {
    cycleId: ID!
    cycleNumber: Int!
    completedIssues: Int!
    completedPoints: Float!
  }

  type CycleVelocityResult {
    averageIssues: Float!
    cycles: [CycleVelocityCycle!]!
  }

  type CycleBurndownPoint {
    date: String!
    remaining: Int!
    completed: Int!
    scope: Int!
  }

  input CycleCreateInput {
    id: String
    teamId: String!
    name: String
    description: String
    startsAt: DateTime!
    endsAt: DateTime!
  }

  input CycleUpdateInput {
    name: String
    description: String
    startsAt: DateTime
    endsAt: DateTime
  }

  type Document {
    id: ID!
    organizationId: ID!
    teamId: ID
    projectId: ID
    creatorId: ID
    parentId: ID
    title: String!
    content: String
    icon: String
    sortOrder: Float!
    createdAt: DateTime!
    updatedAt: DateTime!
    archivedAt: DateTime
  }

  input DocumentCreateInput {
    id: ID
    teamId: ID
    projectId: ID
    parentId: ID
    title: String!
    content: String
    icon: String
  }

  input DocumentUpdateInput {
    title: String
    content: String
    icon: String
    sortOrder: Float
    parentId: ID
  }

  type DocumentMutationResult {
    success: Boolean!
    document: Document
    lastSyncId: String!
  }

  type CustomView {
    id: ID!
    organizationId: ID!
    teamId: ID
    creatorId: ID!
    name: String!
    description: String
    icon: String
    color: String
    filters: JSON!
    sort: JSON!
    groupBy: String
    layout: String!
    shared: Boolean!
    sortOrder: Float!
    creator: User!
    team: Team
    createdAt: DateTime!
    updatedAt: DateTime!
    archivedAt: DateTime
  }

  type CustomViewPayload {
    success: Boolean!
    customView: CustomView
    lastSyncId: String!
  }

  input CustomViewCreateInput {
    id: String
    name: String!
    description: String
    icon: String
    color: String
    filters: JSON
    sort: JSON
    groupBy: String
    layout: String
    shared: Boolean
    teamId: String
    sortOrder: Float
  }

  input CustomViewUpdateInput {
    name: String
    description: String
    icon: String
    color: String
    filters: JSON
    sort: JSON
    groupBy: String
    layout: String
    shared: Boolean
    sortOrder: Float
  }

  enum IssueRelationType {
    related
    blocks
    blocked_by
    duplicate
  }

  type IssueRelation {
    id: ID!
    issueId: ID!
    relatedIssueId: ID!
    type: IssueRelationType!
    issue: Issue!
    relatedIssue: Issue!
    createdAt: DateTime!
  }

  type IssueRelationPayload {
    success: Boolean!
    issueRelation: IssueRelation
    lastSyncId: String!
  }

  input IssueRelationCreateInput {
    issueId: String!
    relatedIssueId: String!
    type: IssueRelationType!
  }

  type IssueTemplate {
    id: ID!
    teamId: ID!
    creatorId: ID
    name: String!
    description: String
    templateData: JSON!
    isDefault: Boolean!
    team: Team!
    creator: User
    createdAt: DateTime!
    updatedAt: DateTime!
    archivedAt: DateTime
  }

  type IssueTemplatePayload {
    success: Boolean!
    issueTemplate: IssueTemplate
    lastSyncId: String!
  }

  input IssueTemplateCreateInput {
    teamId: String!
    name: String!
    description: String
    templateData: JSON
    isDefault: Boolean
  }

  input IssueTemplateUpdateInput {
    name: String
    description: String
    templateData: JSON
    isDefault: Boolean
  }

  enum CustomFieldType {
    text
    number
    date
    select
    multi_select
    url
    checkbox
  }

  type CustomFieldDefinition {
    id: ID!
    """
    Team this definition is scoped to. Null for workspace-scoped
    definitions (apply to every team in the org).
    """
    teamId: ID
    organizationId: ID!
    name: String!
    type: CustomFieldType!
    description: String
    required: Boolean!
    options: JSON
    sortOrder: Float!
    createdAt: DateTime!
    updatedAt: DateTime!
    archivedAt: DateTime
    """Null for workspace-scoped definitions."""
    team: Team
  }

  type CustomFieldValue {
    id: ID!
    issueId: ID!
    definitionId: ID!
    value: JSON!
    createdAt: DateTime!
    updatedAt: DateTime!
    definition: CustomFieldDefinition!
  }

  type CustomFieldDefinitionPayload {
    success: Boolean!
    customFieldDefinition: CustomFieldDefinition
    lastSyncId: String!
  }

  type CustomFieldValuesPayload {
    success: Boolean!
    values: [CustomFieldValue!]!
    lastSyncId: String!
  }

  input CustomFieldOptionInput {
    value: String!
    label: String!
    color: String
  }

  input CustomFieldDefinitionCreateInput {
    """
    Team to attach the definition to. Pass null to create a workspace-scoped
    definition that shows on every team (owner/admin only).
    """
    teamId: String
    name: String!
    type: CustomFieldType!
    description: String
    required: Boolean
    options: [CustomFieldOptionInput!]
    sortOrder: Float
  }

  input CustomFieldDefinitionUpdateInput {
    name: String
    description: String
    required: Boolean
    options: [CustomFieldOptionInput!]
    sortOrder: Float
  }

  input CustomFieldValueInput {
    definitionId: String!
    value: JSON
  }

  type File {
    id: ID!
    name: String!
    key: String!
    size: Int!
    mimeType: String!
    url: String!
    issueId: ID
    projectId: ID
    uploaderId: ID
    createdAt: DateTime!
  }

  scalar JSON

  type Comment {
    id: ID!
    issueId: ID!
    authorId: ID!
    body: String!
    bodyData: JSON
    parentId: ID
    resolvedAt: DateTime
    resolvedById: ID
    editedAt: DateTime
    createdAt: DateTime!
    updatedAt: DateTime!
    archivedAt: DateTime
    author: User!
    parent: Comment
    replies: [Comment!]!
    resolvedBy: User
    reactions: [CommentReaction!]!
    replyCount: Int!
  }

  type CommentReaction {
    id: ID!
    commentId: ID!
    userId: ID!
    emoji: String!
    user: User!
    createdAt: DateTime!
  }

  type CommentPayload {
    success: Boolean!
    comment: Comment
    lastSyncId: String!
  }

  type CommentReactionPayload {
    success: Boolean!
    reaction: CommentReaction
    lastSyncId: String!
  }

  input CommentCreateInput {
    id: String
    issueId: String!
    body: String!
    bodyData: JSON
    parentId: String
  }

  input CommentUpdateInput {
    body: String
    bodyData: JSON
  }

  type OrganizationMemberEntry {
    userId: ID!
    role: String!
  }

  enum InitiativeStatus {
    planned
    active
    completed
    canceled
  }

  type Initiative {
    id: ID!
    organizationId: ID!
    name: String!
    description: String
    icon: String
    color: String!
    status: InitiativeStatus!
    priority: Int!
    sortOrder: Float!
    targetDate: Date
    startDate: Date
    startDateResolution: String
    targetDateResolution: String
    progress: Float!
    ownerId: ID
    creatorId: ID
    parentId: ID
    owner: User
    creator: User
    parent: Initiative
    children: [Initiative!]!
    projects: [Project!]!
    updates: [InitiativeUpdate!]!
    health: String!
    startedAt: DateTime
    completedAt: DateTime
    canceledAt: DateTime
    createdAt: DateTime!
    updatedAt: DateTime!
    archivedAt: DateTime
  }

  type InitiativeUpdate {
    id: ID!
    initiativeId: ID!
    body: String!
    bodyData: JSON!
    health: String!
    user: User!
    editedAt: DateTime
    createdAt: DateTime!
    updatedAt: DateTime!
    archivedAt: DateTime
  }

  type InitiativeUpdatePayload {
    success: Boolean!
    initiativeUpdate: InitiativeUpdate
    lastSyncId: String!
  }

  input InitiativeUpdateCreateInput {
    id: String
    initiativeId: String!
    body: String!
    bodyData: JSON!
    health: String!
  }

  input InitiativeUpdateEditInput {
    body: String
    bodyData: JSON
    health: String
  }

  type InitiativePayload {
    success: Boolean!
    initiative: Initiative
    lastSyncId: String!
  }

  input InitiativeCreateInput {
    id: String
    name: String!
    description: String
    icon: String
    color: String
    status: InitiativeStatus
    priority: Int
    sortOrder: Float
    targetDate: Date
    startDate: Date
    startDateResolution: String
    targetDateResolution: String
    ownerId: String
    parentId: String
    projectIds: [String!]
  }

  input InitiativeUpdateInput {
    name: String
    description: String
    icon: String
    color: String
    status: InitiativeStatus
    priority: Int
    prioritySortOrder: Float
    sortOrder: Float
    targetDate: Date
    startDate: Date
    startDateResolution: String
    targetDateResolution: String
    ownerId: String
    parentId: String
  }

  type Webhook {
    id: ID!
    organizationId: ID!
    name: String!
    url: String!
    events: [String!]!
    """
    HMAC-SHA256 signing secret used to compute the X-Bilinear-Signature
    header. Returned only to org owners/admins (the field-level resolver
    returns null for other callers as defense in depth, even though
    webhook queries themselves require admin role).
    """
    signingSecret: String
    enabled: Boolean!
    teamId: ID
    lastDeliveryAt: DateTime
    lastSuccessAt: DateTime
    consecutiveFailures: Int!
    createdAt: DateTime!
    updatedAt: DateTime!
    archivedAt: DateTime
  }

  """
  Webhook mutations don't emit SyncActions (webhooks are admin-only and
  not mirrored into the org-wide sync stream), so these payloads omit
  the lastSyncId field that other mutation results carry.
  """
  type WebhookPayload {
    success: Boolean!
    webhook: Webhook
  }

  type WebhookDeletePayload {
    success: Boolean!
  }

  type WebhookDelivery {
    id: ID!
    webhookId: ID!
    event: String!
    status: String!
    attempts: Int!
    responseStatus: Int
    responseBody: String
    errorMessage: String
    nextAttemptAt: DateTime
    deliveredAt: DateTime
    createdAt: DateTime!
    updatedAt: DateTime!
  }

  input WebhookCreateInput {
    name: String!
    url: String!
    events: [String!]!
    enabled: Boolean
    teamId: String
  }

  input WebhookUpdateInput {
    name: String
    url: String
    events: [String!]
    enabled: Boolean
    teamId: String
  }

  # ------------------------------------------------------------------
  # Audit Log (admin-only)
  # ------------------------------------------------------------------
  type AuditLogEntry {
    action: String!
    createdAt: DateTime!
    id: ID!
    ipAddress: String
    metadata: JSON
    organizationId: ID!
    resourceId: ID
    resourceType: String
    user: User
    userAgent: String
    userId: ID
  }

  type AuditLogPage {
    entries: [AuditLogEntry!]!
    hasMore: Boolean!
    nextCursor: String
  }

  input AuditLogFilter {
    action: String
    cursor: String
    from: DateTime
    limit: Int
    resourceType: String
    to: DateTime
    userId: ID
  }

  input IssueTriageAcceptInput {
    stateId: String!
    assigneeId: String
    priority: Int
    cycleId: String
  }

  # ------------------------------------------------------------------
  # Analytics (PRD §2.24, gap §6.1)
  # ------------------------------------------------------------------
  input AnalyticsInput {
    # Required so every analytics query is scoped to a single team's issue
    # set. Without this, an unbounded org-wide aggregate scan over millions
    # of issues costs the GraphQL complexity estimator only 1 — leaving a
    # cheap DoS vector for any authenticated caller. See PRD §2.24.
    teamId: String!
    from: Date
    to: Date
  }

  type AnalyticsHistogramBucket {
    bucketStart: Float!
    bucketEnd: Float!
    count: Int!
  }

  type AnalyticsThroughputPoint {
    weekStart: String!
    count: Int!
  }

  type AnalyticsTimeInStateRow {
    stateId: ID!
    avgHours: Float!
    sampleSize: Int!
  }

  type TeamHealthResult {
    overdueCount: Int!
    unestimatedCount: Int!
    unestimatedPct: Float!
    openCount: Int!
    oldestOpenAgeDays: Float!
    p75AgeDays: Float!
  }

  type CycleVelocityPoint {
    cycleId: ID!
    cycleNumber: Int!
    cycleStartsAt: String!
    completedIssues: Int!
    completedPoints: Float!
  }

  type CycleVelocityTrendResult {
    cycles: [CycleVelocityPoint!]!
    rolling3: Float!
    rolling6: Float!
    rolling12: Float!
    rolling3Points: Float!
    rolling6Points: Float!
    rolling12Points: Float!
  }

  type CycleScopeMetrics {
    totalCount: Int!
    plannedCount: Int!
    completedCount: Int!
    scopeCreepCount: Int!
    scopeCreepPct: Float!
    carryoverCount: Int!
    carryoverPct: Float!
  }

  type WorkspaceTeamStats {
    teamId: ID!
    teamName: String!
    totalCount: Int!
    openCount: Int!
    completedCount: Int!
    completionRate: Float!
    avgCycleTimeDays: Float!
  }

  type WorkspaceOverviewResult {
    teams: [WorkspaceTeamStats!]!
    totalIssues: Int!
    totalOpen: Int!
    totalCompleted: Int!
  }

  # ------------------------------------------------------------------
  # Automation rules (PRD §2.23, gap §2.1)
  # ------------------------------------------------------------------
  type AutomationRule {
    id: ID!
    organizationId: ID!
    teamId: ID
    name: String!
    description: String
    triggerType: String!
    triggerConfig: JSON!
    conditions: JSON
    actions: JSON!
    enabled: Boolean!
    sortOrder: Float!
    lastRunAt: DateTime
    runCount: Int!
    createdAt: DateTime!
    updatedAt: DateTime!
    archivedAt: DateTime
  }

  type AutomationRulePayload {
    success: Boolean!
    rule: AutomationRule
    lastSyncId: String!
  }

  input AutomationRuleCreateInput {
    name: String!
    description: String
    teamId: String
    triggerType: String!
    triggerConfig: JSON
    conditions: JSON
    actions: JSON!
    enabled: Boolean
    sortOrder: Float
  }

  input AutomationRuleUpdateInput {
    name: String
    description: String
    triggerType: String
    triggerConfig: JSON
    conditions: JSON
    actions: JSON
    enabled: Boolean
    sortOrder: Float
  }

  type Query {
    viewer: User!
    organization: Organization!
    organizationMembers: [OrganizationMemberEntry!]!
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
    cycle(id: ID!): Cycle!
    cycles(teamId: String!, includeArchived: Boolean): [Cycle!]!
    cycleVelocity(teamId: ID!, cycleCount: Int): CycleVelocityResult!
    cycleBurndown(cycleId: ID!): [CycleBurndownPoint!]!
    customView(id: ID!): CustomView!
    customViews(teamId: String): [CustomView!]!
    documents(teamId: ID, projectId: ID): [Document!]!
    document(id: ID!): Document
    project(id: ID!): Project!
    projects(
      filter: ProjectFilter
      first: Int
      after: String
      includeArchived: Boolean
    ): ProjectConnection!
    notifications(limit: Int): [Notification!]!
    notificationUnreadCount: Int!
    notificationIsSubscribed(issueId: ID!): Boolean!
    issueActivities(issueId: ID!, limit: Int): [IssueActivity!]!
    issueRelations(issueId: ID!): [IssueRelation!]!
    issueTemplates(teamId: String!, includeArchived: Boolean): [IssueTemplate!]!
    issueTemplate(id: ID!): IssueTemplate!
    customFieldDefinitions(teamId: String!, includeArchived: Boolean): [CustomFieldDefinition!]!
    """Workspace-scoped custom fields (teamId IS NULL) — apply to every team."""
    workspaceCustomFieldDefinitions(includeArchived: Boolean): [CustomFieldDefinition!]!
    customFieldDefinition(id: ID!): CustomFieldDefinition!
    customFieldValuesForIssue(issueId: ID!): [CustomFieldValue!]!
    comments(issueId: ID!, includeArchived: Boolean): [Comment!]!
    comment(id: ID!): Comment!
    issueFiles(issueId: ID!): [File!]!
    publicRoadmap: PublicRoadmap
    publicRoadmapPage(slug: String!, password: String): PublicRoadmapPage!

    triageQueue(teamId: ID!): [Issue!]!
    triageQueueCount(teamId: ID!): Int!

    initiative(id: ID!): Initiative!
    initiatives(includeArchived: Boolean): [Initiative!]!

    webhook(id: ID!): Webhook!
    webhooks(includeArchived: Boolean): [Webhook!]!
    webhookDeliveries(webhookId: ID!, limit: Int): [WebhookDelivery!]!
    webhookEvents: [String!]!

    # Automation rules
    automationRule(id: ID!): AutomationRule!
    automationRules: [AutomationRule!]!
    automationTriggerTypes: [String!]!
    automationActionTypes: [String!]!

    # Analytics / Insights (PRD §2.24)
    analyticsLeadTimeHistogram(input: AnalyticsInput): [AnalyticsHistogramBucket!]!
    analyticsCycleTimeHistogram(input: AnalyticsInput): [AnalyticsHistogramBucket!]!
    analyticsThroughputByWeek(input: AnalyticsInput): [AnalyticsThroughputPoint!]!
    analyticsTimeInState(input: AnalyticsInput): [AnalyticsTimeInStateRow!]!
    analyticsTeamHealth(input: AnalyticsInput): TeamHealthResult!
    analyticsCycleVelocityTrend(input: AnalyticsInput): CycleVelocityTrendResult!
    analyticsCycleScopeMetrics(cycleId: ID!): CycleScopeMetrics!
    analyticsWorkspaceOverview: WorkspaceOverviewResult!

    # Audit log — org admin only
    auditLogs(filter: AuditLogFilter): AuditLogPage!

    # Favorites — sidebar pinning, per user
    favorites: [Favorite!]!

    # GitHub Integration
    githubIntegration: GitHubIntegration

    """
    Begin a Google OAuth flow. Returns the consent URL (with
    server-controlled redirect_uri and a signed CSRF state) that the client
    should redirect the browser to. The returned state must be stored and
    passed to googleAuthExchange when the callback fires.
    """
    googleAuthStart: GoogleAuthStartPayload!

    """Returns the SAML SSO configuration for the authenticated org. Null if not configured. Owner/admin only."""
    samlConfiguration: SamlConfiguration

    """List active SCIM provisioning tokens for the org. Admin only."""
    scimTokens: [ScimToken!]!
  }

  type GoogleAuthStartPayload {
    url: String!
    state: String!
  }

  type Mutation {
    emailLogin(input: EmailLoginInput!): EmailLoginPayload!
    emailVerify(input: EmailVerifyInput!): AuthPayload!
    """
    Exchange a Google OAuth authorization code for a session. The state
    token must match the one returned by googleAuthStart or the request
    is rejected as CSRF.
    """
    googleAuthExchange(code: String!, state: String!): AuthPayload!
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
    issueReactionAdd(issueId: ID!, emoji: String!): IssueReactionPayload!
    issueReactionRemove(issueId: ID!, emoji: String!): DeletePayload!
    """
    Snooze an issue until the given ISO timestamp (must be in the future).
    Snoozed issues stay in the DB but are hidden from list views until
    the timestamp passes — no background job involved.
    """
    issueSnooze(id: ID!, until: DateTime!): IssuePayload!
    issueUnsnooze(id: ID!): IssuePayload!
    """
    Apply the same patch to up to 200 issues in a single transaction.
    State transitions, label changes, assignee/project moves all work.
    Auto-close cascades are intentionally skipped — see service docs.
    """
    issuesBulkUpdate(ids: [ID!]!, input: IssueUpdateInput!): IssueBulkUpdatePayload!

    issueLabelCreate(input: IssueLabelCreateInput!): IssueLabelPayload!
    issueLabelUpdate(id: ID!, input: IssueLabelUpdateInput!): IssueLabelPayload!
    issueLabelArchive(id: ID!): IssueLabelPayload!

    customViewCreate(input: CustomViewCreateInput!): CustomViewPayload!
    customViewUpdate(id: ID!, input: CustomViewUpdateInput!): CustomViewPayload!
    customViewArchive(id: ID!): CustomViewPayload!
    customViewDelete(id: ID!): DeletePayload!

    documentCreate(input: DocumentCreateInput!): DocumentMutationResult!
    documentUpdate(id: ID!, input: DocumentUpdateInput!): DocumentMutationResult!
    documentArchive(id: ID!): DocumentMutationResult!
    documentDelete(id: ID!): DeletePayload!

    cycleCreate(input: CycleCreateInput!): CyclePayload!
    cycleUpdate(id: ID!, input: CycleUpdateInput!): CyclePayload!
    cycleArchive(id: ID!): CyclePayload!
    cycleDelete(id: ID!): DeletePayload!
    cycleAddIssue(cycleId: ID!, issueId: ID!): IssuePayload!
    cycleRemoveIssue(issueId: ID!): IssuePayload!
    cycleRollover(cycleId: ID!): CycleRolloverPayload!

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

    notificationMarkRead(id: ID!): NotificationPayload!
    notificationMarkAllRead: DeletePayload!
    notificationSnooze(id: ID!, until: DateTime!): NotificationPayload!
    notificationSubscribe(issueId: ID!): DeletePayload!
    notificationUnsubscribe(issueId: ID!): DeletePayload!

    issueRelationCreate(input: IssueRelationCreateInput!): IssueRelationPayload!
    issueRelationDelete(id: ID!): DeletePayload!

    issueTemplateCreate(input: IssueTemplateCreateInput!): IssueTemplatePayload!
    issueTemplateUpdate(id: ID!, input: IssueTemplateUpdateInput!): IssueTemplatePayload!
    issueTemplateArchive(id: ID!): IssueTemplatePayload!
    issueTemplateDelete(id: ID!): DeletePayload!

    customFieldDefinitionCreate(input: CustomFieldDefinitionCreateInput!): CustomFieldDefinitionPayload!
    customFieldDefinitionUpdate(id: ID!, input: CustomFieldDefinitionUpdateInput!): CustomFieldDefinitionPayload!
    customFieldDefinitionArchive(id: ID!): CustomFieldDefinitionPayload!
    customFieldDefinitionDelete(id: ID!): DeletePayload!
    customFieldValuesSet(issueId: ID!, values: [CustomFieldValueInput!]!): CustomFieldValuesPayload!

    commentCreate(input: CommentCreateInput!): CommentPayload!
    commentUpdate(id: ID!, input: CommentUpdateInput!): CommentPayload!
    commentDelete(id: ID!): DeletePayload!
    commentResolve(id: ID!): CommentPayload!
    commentUnresolve(id: ID!): CommentPayload!
    commentReactionAdd(commentId: ID!, emoji: String!): CommentReactionPayload!
    commentReactionRemove(commentId: ID!, emoji: String!): DeletePayload!

    organizationMemberUpdateRole(userId: ID!, role: String!): DeletePayload!

    fileDelete(id: ID!): DeletePayload!

    publicRoadmapUpsert(input: PublicRoadmapUpsertInput!): PublicRoadmapUpsertResult!
    projectSetRoadmapVisible(id: ID!, visible: Boolean!): ProjectMutationResult!

    issueTriageAccept(issueId: ID!, input: IssueTriageAcceptInput!): IssuePayload!
    issueTriageDecline(issueId: ID!): IssuePayload!
    issueTriageMarkDuplicate(issueId: ID!, canonicalIssueId: ID!): IssuePayload!
    issueTriageSnooze(issueId: ID!, until: DateTime!): IssuePayload!

    initiativeCreate(input: InitiativeCreateInput!): InitiativePayload!
    initiativeUpdate(id: ID!, input: InitiativeUpdateInput!): InitiativePayload!
    initiativeArchive(id: ID!): InitiativePayload!
    initiativeDelete(id: ID!): DeletePayload!
    initiativeAddProject(initiativeId: ID!, projectId: ID!): InitiativePayload!
    initiativeRemoveProject(initiativeId: ID!, projectId: ID!): InitiativePayload!
    initiativeUpdateCreate(input: InitiativeUpdateCreateInput!): InitiativeUpdatePayload!
    initiativeUpdateUpdate(id: ID!, input: InitiativeUpdateEditInput!): InitiativeUpdatePayload!
    initiativeUpdateDelete(id: ID!): DeletePayload!

    webhookCreate(input: WebhookCreateInput!): WebhookPayload!
    webhookUpdate(id: ID!, input: WebhookUpdateInput!): WebhookPayload!
    webhookArchive(id: ID!): WebhookPayload!
    webhookDelete(id: ID!): WebhookDeletePayload!
    webhookRotateSecret(id: ID!): WebhookPayload!

    # Automation rules
    automationRuleCreate(input: AutomationRuleCreateInput!): AutomationRulePayload!
    automationRuleUpdate(id: ID!, input: AutomationRuleUpdateInput!): AutomationRulePayload!
    automationRuleArchive(id: ID!): AutomationRulePayload!

    # Favorites
    favoriteCreate(input: FavoriteCreateInput!): FavoritePayload!
    favoriteDelete(id: ID!): DeletePayload!
    favoriteReorder(entries: [FavoriteReorderEntryInput!]!): FavoriteListPayload!

    # GitHub Integration
    githubDisconnect: BasicPayload!
    githubRotateWebhookSecret(newSecret: String!): GitHubIntegrationPayload!

    # User notification preferences
    userUpdateNotificationPreferences(emailNotificationsEnabled: Boolean!): UserPayload!

    # Rotate the per-user iCal feed token. Returns the updated user so the
    # caller can immediately display the new feed URL.
    userCalendarFeedTokenRotate: UserPayload!

    # SAML SSO configuration — owner/admin only
    samlConfigurationSave(input: SamlConfigurationInput!): SamlConfigurationPayload!
    samlConfigurationDelete: SamlDeletePayload!

    # SCIM provisioning token management — admin only
    scimTokenCreate(label: String!): ScimTokenCreatePayload!
    scimTokenRevoke(id: ID!): ScimTokenRevokePayload!
  }

  # ---------------------------------------------------------------------------
  # GitHub Integration
  # ---------------------------------------------------------------------------

  type GitHubIntegration {
    id: ID!
    organizationId: ID!
    githubLogin: String!
    createdAt: DateTime!
    updatedAt: DateTime!
  }

  type GitHubPullRequest {
    id: ID!
    issueId: ID!
    prNumber: Int!
    title: String!
    url: String!
    state: String!
    draft: Boolean!
    headBranch: String!
    repoFullName: String!
    authorLogin: String!
    mergedAt: DateTime
    closedAt: DateTime
    createdAt: DateTime!
    updatedAt: DateTime!
  }

  type GitHubIntegrationPayload {
    success: Boolean!
    integration: GitHubIntegration
  }

  type UserPayload {
    success: Boolean!
    user: User
  }

  # ---------------------------------------------------------------------------
  # Favorites (sidebar pinning)
  # ---------------------------------------------------------------------------

  enum FavoriteEntityType {
    Issue
    Project
    Initiative
    CustomView
    Cycle
    Document
    Team
  }

  union FavoriteEntity = Issue | Project | Initiative | CustomView | Cycle | Document | Team

  type Favorite {
    id: ID!
    userId: ID!
    organizationId: ID!
    entityType: FavoriteEntityType!
    entityId: ID!
    sortOrder: Float!
    createdAt: DateTime!
    """
    Resolved target entity. Null if the referenced row was deleted or
    moved to a different org — the sidebar component skips null entries.
    """
    entity: FavoriteEntity
  }

  type FavoritePayload {
    success: Boolean!
    favorite: Favorite
    lastSyncId: String!
  }

  type FavoriteListPayload {
    success: Boolean!
    favorites: [Favorite!]!
    lastSyncId: String!
  }

  input FavoriteCreateInput {
    entityType: FavoriteEntityType!
    entityId: ID!
    sortOrder: Float
  }

  input FavoriteReorderEntryInput {
    id: ID!
    sortOrder: Float!
  }

  # ---------------------------------------------------------------------------
  # SAML SSO
  # ---------------------------------------------------------------------------

  type SamlConfiguration {
    createdAt: DateTime!
    emailAttribute: String!
    enabled: Boolean!
    id: ID!
    idpEntityId: String!
    idpMetadataUrl: String
    idpSsoUrl: String!
    jitProvisioning: Boolean!
    nameAttribute: String!
    organizationId: ID!
    ssoEnforced: Boolean!
    updatedAt: DateTime!
  }

  input SamlConfigurationInput {
    emailAttribute: String
    enabled: Boolean
    idpCert: String
    idpEntityId: String!
    idpMetadataUrl: String
    idpMetadataXml: String
    idpSsoUrl: String!
    jitProvisioning: Boolean
    nameAttribute: String
    ssoEnforced: Boolean
  }

  """
  SAML and SCIM mutations don't emit SyncActions (they are admin-only config and
  not mirrored into the org-wide sync stream), so these payloads omit lastSyncId.
  """
  type SamlConfigurationPayload {
    configuration: SamlConfiguration
    success: Boolean!
  }

  type SamlDeletePayload {
    success: Boolean!
  }

  # ---------------------------------------------------------------------------
  # SCIM 2.0 provisioning token management
  # ---------------------------------------------------------------------------

  """A SCIM provisioning token (hashed; plaintext shown only on creation)."""
  type ScimToken {
    createdAt: DateTime!
    id: ID!
    label: String!
    lastUsedAt: DateTime
  }

  type ScimTokenCreatePayload {
    """Only populated on the initial creation response — never stored."""
    plaintext: String
    success: Boolean!
    token: ScimToken
  }

  type ScimTokenRevokePayload {
    success: Boolean!
  }
`;
