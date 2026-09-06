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
    """
    Global platform-operator flag. Exposed as false for users other than
    the viewer themselves — use the platform console queries for a full roster.
    """
    isPlatformAdmin: Boolean!
    timezone: String
    lastSeen: DateTime
    statusEmoji: String
    statusLabel: String
    statusUntilAt: DateTime
    emailNotificationsEnabled: Boolean!
    "Persisted language preference (app locale, e.g. 'en' / 'es'); null if never set."
    locale: String
    "Persisted accent-colour preference (e.g. 'aurora'); null if never chosen."
    accent: String
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
    aiEnabled: Boolean!
    createdAt: DateTime!
    updatedAt: DateTime!
    archivedAt: DateTime
    "Per-org plan-tier caps. Read-only for org members; edited by platform admins."
    planLimits: OrganizationPlanLimits!
  }

  """
  Per-org plan-tier caps. Backed by registry-declared settings rather than
  columns; the shape is unchanged so clients see no difference.
  """
  type OrganizationPlanLimits {
    maxCustomFieldsPerTeam: Int!
    maxCustomFieldsPerOrg: Int!
    maxLabelGroupChildren: Int!
    maxInitiativeDepth: Int!
    maxExportRows: Int!
  }

  input OrganizationPlanLimitsInput {
    maxCustomFieldsPerTeam: Int!
    maxCustomFieldsPerOrg: Int!
    maxLabelGroupChildren: Int!
    maxInitiativeDepth: Int!
    maxExportRows: Int!
  }

  "Scope a configuration value can be stored at."
  enum SettingScope {
    platform
    org
    team
    user
  }

  """
  One resolved configuration knob: its declaration, its effective value, and
  which layer supplied it.

  The value is a JSON scalar because a knob may be an int, a boolean, a string
  or an enum — the registry carries the type. It is null for a redacted knob;
  those report only envVarName and envIsSet.
  """
  type ResolvedSetting {
    key: String!
    value: JSON
    "Which layer supplied the value: code-default, env, platform, org, team or user."
    source: String!
    """
    True when an override-mode environment variable supplied the value, so no
    stored value can take effect. Clients MUST render such a knob read-only —
    accepting a write that silently does nothing is the failure this prevents.
    """
    locked: Boolean!
    """
    True when THIS caller may change the knob at the scope they asked for.

    Server-computed, because it is an authorization answer and the client cannot
    reach the facts it needs — the caller's effective role, which folds in
    platform-admin status. A client deriving it from editableBy alone gets it
    wrong in both directions: editableBy is a floor, not an equality, and it
    says nothing about whether the caller may reach the scope at all.
    """
    writable: Boolean!
    type: String!
    scopes: [SettingScope!]!
    editableBy: String!
    labelKey: String!
    min: Float
    max: Float
    enumValues: [String!]
    "Value is only read at process start; changing it needs a restart."
    restartRequired: Boolean!
    "Value is never returned. Secrets are always redacted."
    redacted: Boolean!
    "Name of the bound environment variable, when the knob has one."
    envVarName: String
    "Whether that environment variable is currently set. Safe for redacted knobs."
    envIsSet: Boolean!
  }

  input SettingWriteInput {
    key: String!
    scope: SettingScope!
    "Org or team id. Ignored for platform scope, which has no entity."
    scopeId: ID
    value: JSON!
  }

  type SettingPayload {
    success: Boolean!
    setting: ResolvedSetting!
    lastSyncId: String
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
    cycleDuration: Int
    cycleStartDay: Int
    cycleCooldownTime: Int
    autoClosePeriod: Int
    autoArchivePeriod: Int
    autoCloseChildIssues: Boolean!
    autoCloseParentIssues: Boolean!
    issueEstimationType: IssueEstimationType!
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
    teamId: ID!
    name: String!
    color: String!
    description: String
    type: WorkflowStateType!
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
    "Set when the issue leaves the triage queue (accept / decline / duplicate); null while it is still queued."
    triagedAt: DateTime
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
    id: ID
    title: String!
    description: String
    teamId: ID!
    stateId: ID
    assigneeId: ID
    priority: Int
    estimate: Float
    startDate: Date
    dueDate: Date
    labelIds: [ID!]
    parentId: ID
    sortOrder: Float
    projectId: ID
    projectMilestoneId: ID
    cycleId: ID
  }

  input IssueUpdateInput {
    title: String
    description: String
    stateId: ID
    assigneeId: ID
    priority: Int
    estimate: Float
    startDate: Date
    dueDate: Date
    labelIds: [ID!]
    parentId: ID
    sortOrder: Float
    prioritySortOrder: Float
    trashed: Boolean
    projectId: ID
    projectMilestoneId: ID
    cycleId: ID
  }

  input IssueFilter {
    teamId: ID
    stateId: ID
    assigneeId: ID
    priority: Int
    trashed: Boolean
    """
    Include snoozed issues that haven't woken up yet. Default false —
    snoozed issues are hidden from lists until now() reaches snoozedUntilAt.
    """
    includeSnoozed: Boolean
  }

  input IssueLabelCreateInput {
    id: ID
    name: String!
    color: String!
    description: String
    teamId: ID
    parentId: ID
    isGroup: Boolean
  }

  input IssueLabelUpdateInput {
    name: String
    color: String
    description: String
    parentId: ID
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

  """
  Workspace identity. Every field is optional; omitting one leaves it alone.
  logoUrl accepts null to clear it, which is distinct from omitting it.
  """
  input OrganizationUpdateInput {
    name: String
    urlKey: String
    logoUrl: String
  }

  type OrganizationPayload {
    success: Boolean!
    organization: Organization!
    lastSyncId: String!
  }

  """
  The session was re-issued into an organization — returned by every
  mutation that lands the caller in a (possibly different) workspace:
  creating one, switching to one, or accepting an invitation to one. The
  client installs the tokens before navigating; the client's enterWorkspace
  helper already treated these three as one shape.
  """
  type EnterOrganizationPayload {
    success: Boolean!
    organization: Organization!
    accessToken: String!
    refreshToken: String!
    expiresIn: Int!
  }

  """
  The session after the caller left a workspace.

  Deliberately not EnterOrganizationPayload: that type's organization is
  non-null because you always land somewhere, whereas leaving your last
  workspace legitimately lands you nowhere. A null organization here means an
  org-less session, which still authenticates for viewerOrganizations and the
  create-workspace flow.
  """
  type LeaveOrganizationPayload {
    success: Boolean!
    lastSyncId: String!
    organization: Organization
    accessToken: String!
    refreshToken: String!
    expiresIn: Int!
  }

  """
  One workspace the signed-in user can enter, as shown in the workspace
  switcher. Only organizations they still belong to and that are neither
  archived nor suspended appear — the list is "where can I go", not "where
  have I ever been".
  """
  type ViewerOrganization {
    id: ID!
    name: String!
    urlKey: String!
    logoUrl: String
    """The viewer's role in this organization: owner, admin, member, or guest."""
    role: OrganizationRole!
    """True for the organization the current session is authenticated to."""
    current: Boolean!
  }

  input TeamCreateInput {
    id: ID
    name: String!
    key: String!
    description: String
    icon: String
    color: String
    private: Boolean
    timezone: String
    triageEnabled: Boolean
    parentId: ID
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
    cycleStartDay: Int
    cycleCooldownTime: Int
    issueEstimationType: IssueEstimationType
    triageEnabled: Boolean
    autoClosePeriod: Int
    autoArchivePeriod: Int
    autoCloseChildIssues: Boolean
    autoCloseParentIssues: Boolean
    defaultIssueStateId: ID
    parentId: ID
  }

  enum TeamDeleteIssueAction {
    DELETE
    MOVE
  }

  input TeamDeleteInput {
    issueAction: TeamDeleteIssueAction!
    moveToTeamId: ID
  }

  input TeamMembershipCreateInput {
    teamId: ID!
    userId: ID!
    isOwner: Boolean
    role: TeamMemberRole
  }

  input TeamMembershipUpdateInput {
    isOwner: Boolean
    role: TeamMemberRole
    sortOrder: Float
  }

  input WorkflowStateCreateInput {
    id: ID
    teamId: ID!
    name: String!
    color: String!
    type: WorkflowStateType!
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
    statusType: ProjectStatusType!
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
    statusType: ProjectStatusType!
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
    id: ID
    name: String!
    description: String
    icon: String
    color: String
    statusType: ProjectStatusType
    leadId: ID
    startDate: Date
    targetDate: Date
    startDateResolution: String
    targetDateResolution: String
    teamIds: [ID!]!
    memberIds: [ID!]
  }

  input ProjectUpdateInput {
    name: String
    description: String
    content: String
    icon: String
    color: String
    statusType: ProjectStatusType
    health: String
    leadId: ID
    startDate: Date
    targetDate: Date
    startDateResolution: String
    targetDateResolution: String
    priority: Int
  }

  input ProjectMilestoneCreateInput {
    id: ID
    projectId: ID!
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
    id: ID
    projectId: ID!
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
    statusType: ProjectStatusType
    health: String
    leadId: ID
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
    type: NotificationType!
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
    id: ID
    teamId: ID!
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
    id: ID
    name: String!
    description: String
    icon: String
    color: String
    filters: JSON
    sort: JSON
    groupBy: String
    layout: String
    shared: Boolean
    teamId: ID
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
    issueId: ID!
    relatedIssueId: ID!
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
    teamId: ID!
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

  """A member's role within an organization."""
  enum OrganizationRole {
    owner
    admin
    member
    guest
  }

  enum IssueEstimationType {
    notUsed
    exponential
    fibonacci
    linear
    tShirt
  }

  enum WorkflowStateType {
    triage
    backlog
    unstarted
    started
    completed
    canceled
  }

  enum ProjectStatusType {
    backlog
    planned
    inProgress
    paused
    completed
    canceled
  }

  enum NotificationType {
    ISSUE_ASSIGNED
    ISSUE_STATUS_CHANGED
    ISSUE_MENTIONED
    ISSUE_COMMENTED
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
    teamId: ID
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
    definitionId: ID!
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
    id: ID
    issueId: ID!
    body: String!
    bodyData: JSON
    parentId: ID
  }

  input CommentUpdateInput {
    body: String
    bodyData: JSON
  }

  """An outstanding invitation to join the current organization."""
  type OrganizationInvite {
    id: ID!
    email: String!
    role: OrganizationRole!
    invitedById: ID
    expiresAt: DateTime!
    createdAt: DateTime!
  }

  type OrganizationInvitePayload {
    success: Boolean!
    invite: OrganizationInvite!
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
    id: ID
    initiativeId: ID!
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
    id: ID
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
    ownerId: ID
    parentId: ID
    projectIds: [ID!]
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
    ownerId: ID
    parentId: ID
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
    teamId: ID
  }

  input WebhookUpdateInput {
    name: String
    url: String
    events: [String!]
    enabled: Boolean
    teamId: ID
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
    stateId: ID!
    assigneeId: ID
    priority: Int
    cycleId: ID
  }

  # ------------------------------------------------------------------
  # Analytics (PRD §2.24, gap §6.1)
  # ------------------------------------------------------------------
  input AnalyticsInput {
    # Required so every analytics query is scoped to a single team's issue
    # set. Without this, an unbounded org-wide aggregate scan over millions
    # of issues costs the GraphQL complexity estimator only 1 — leaving a
    # cheap DoS vector for any authenticated caller. See PRD §2.24.
    teamId: ID!
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
    teamId: ID
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

  type AiDuplicateIssue {
    id: ID!
    identifier: String!
    title: String!
  }

  type AiTitlePayload {
    success: Boolean!
    title: String!
  }

  type AiSummaryPayload {
    success: Boolean!
    summary: String!
  }

  type AiDuplicatesPayload {
    success: Boolean!
    duplicates: [AiDuplicateIssue!]!
  }

  type AiSettingsPayload {
    success: Boolean!
    organization: Organization!
    lastSyncId: String!
  }

  type CsvImportPreview {
    headers: [String!]!
    rowCount: Int!
    sampleRows: [[String!]!]!
  }

  input CsvImportMappingInput {
    """CSV header for the issue title (required)."""
    title: String!
    description: String
    priority: String
    """CSV header holding an assignee email."""
    assignee: String
    """CSV header holding a workflow-state name."""
    state: String
  }

  input CsvImportInput {
    teamId: ID!
    csv: String!
    mapping: CsvImportMappingInput!
  }

  type CsvImportResult {
    success: Boolean!
    created: Int!
    skipped: Int!
    errors: [String!]!
    lastSyncId: String!
  }

  type SlackIntegration {
    id: ID!
    slackTeamName: String!
    defaultTeamId: ID
    createdAt: DateTime!
  }

  type SlackSettingsPayload {
    success: Boolean!
    integration: SlackIntegration
  }

  type Query {
    """
    Every configuration knob visible to the caller at a scope, with its
    effective value and the layer that supplied it.

    Filtered by each knob's visibleTo role, so an org admin sees the caps they
    cannot edit while platform-only knobs stay hidden. scopeId defaults to the
    caller's own org/team; platform scope needs none.
    """
    settings(scope: SettingScope!, scopeId: ID): [ResolvedSetting!]!
    """One resolved knob, including where its value came from."""
    setting(key: String!, scope: SettingScope!, scopeId: ID): ResolvedSetting!
    """True when AI is configured server-side AND enabled for this workspace."""
    aiAvailable: Boolean!
    """Parse CSV (no writes) to drive the import mapping UI."""
    csvImportPreview(csv: String!): CsvImportPreview!
    """JSON export of issues for a team (or the whole org when teamId omitted)."""
    organizationExport(teamId: ID): String!
    """The connected Slack workspace for this org, or null."""
    slackIntegration: SlackIntegration
    viewer: User!
    organization: Organization!
    """
    Every workspace the viewer can switch into. Resolvable without an active
    organization, so a user whose current workspace was suspended (or whose
    membership in it was revoked) can still see and reach the others.
    """
    viewerOrganizations: [ViewerOrganization!]!
    """Outstanding invitations for the current organization (owner/admin only)."""
    organizationInvites: [OrganizationInvite!]!
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
    labels(teamId: ID): IssueLabelConnection!
    cycle(id: ID!): Cycle!
    cycles(teamId: ID!, includeArchived: Boolean): [Cycle!]!
    cycleVelocity(teamId: ID!, cycleCount: Int): CycleVelocityResult!
    cycleBurndown(cycleId: ID!): [CycleBurndownPoint!]!
    customView(id: ID!): CustomView!
    customViews(teamId: ID): [CustomView!]!
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
    issueTemplates(teamId: ID!, includeArchived: Boolean): [IssueTemplate!]!
    issueTemplate(id: ID!): IssueTemplate!
    customFieldDefinitions(teamId: ID!, includeArchived: Boolean): [CustomFieldDefinition!]!
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

    """
    Begin a GitHub OAuth login flow. Returns the authorize URL (with
    server-controlled redirect_uri and a signed CSRF state) that the client
    should redirect the browser to. The returned state must be stored and
    passed to githubAuthExchange when the callback fires.
    """
    githubAuthStart: GithubAuthStartPayload!

    """Returns the SAML SSO configuration for the authenticated org. Null if not configured. Owner/admin only."""
    samlConfiguration: SamlConfiguration

    """List active SCIM provisioning tokens for the org. Admin only."""
    scimTokens: [ScimToken!]!

    apiTokens: [ApiToken!]!

    # ------------------------------------------------------------------
    # Platform admin console (cross-tenant) — every field requires the
    # caller to carry User.isPlatformAdmin. See PATTERNS.md (Platform admin).
    # ------------------------------------------------------------------
    platformMetrics: PlatformMetrics!
    platformTenants(query: String, includeArchived: Boolean, limit: Int): [PlatformTenant!]!
    platformTenant(id: ID!): PlatformTenantDetail
    platformUsers(query: String, limit: Int): [PlatformUser!]!
    platformUser(id: ID!): PlatformUser
    platformAuditLog(limit: Int, cursor: String): PlatformAuditLogPage!
    """Impersonation state for the current session — drives the banner. Any authenticated user."""
    impersonationState: ImpersonationState!
  }

  type GoogleAuthStartPayload {
    url: String!
    state: String!
  }

  type GithubAuthStartPayload {
    url: String!
    state: String!
  }

  type Mutation {
    """Suggest a concise issue title from a description (requires AI enabled)."""
    aiSuggestIssueTitle(description: String!): AiTitlePayload!
    """Summarize an issue into a short paragraph (requires AI enabled)."""
    aiSummarizeIssue(issueId: ID!): AiSummaryPayload!
    """Detect likely duplicate issues for the given issue (requires AI enabled)."""
    aiFindDuplicateIssues(issueId: ID!): AiDuplicatesPayload!
    """Enable/disable AI features for the workspace (owner/admin only)."""
    aiSettingsUpdate(enabled: Boolean!): AiSettingsPayload!
    """Rename the workspace, change its URL key, or set its logo (owner/admin)."""
    organizationUpdate(input: OrganizationUpdateInput!): OrganizationPayload!
    """
    Store a configuration value at one scope. Validated against the knob's
    registry declaration; rejects a write to a scope the knob does not declare,
    to an env-only knob, or by a caller lacking its editableBy role.
    """
    settingSet(input: SettingWriteInput!): SettingPayload!
    """
    Remove a stored value so the knob falls back to the layer below —
    "reset to inherited". Not the same as writing the default: a stored default
    still shadows a later change to the platform value.
    """
    settingClear(key: String!, scope: SettingScope!, scopeId: ID): SettingPayload!
    """Import issues from CSV into a team (up to 500 rows)."""
    csvImportIssues(input: CsvImportInput!): CsvImportResult!
    """Disconnect the Slack workspace (owner/admin)."""
    slackDisconnect: BasicPayload!
    """Set the team that Slack slash-command issues are filed into (owner/admin)."""
    slackSetDefaultTeam(teamId: ID): SlackSettingsPayload!
    emailLogin(input: EmailLoginInput!): EmailLoginPayload!
    emailVerify(input: EmailVerifyInput!): AuthPayload!
    """
    Exchange a Google OAuth authorization code for a session. The state
    token must match the one returned by googleAuthStart or the request
    is rejected as CSRF.
    """
    googleAuthExchange(code: String!, state: String!): AuthPayload!
    """
    Exchange a GitHub OAuth authorization code for a session. The state
    token must match the one returned by githubAuthStart or the request
    is rejected as CSRF.
    """
    githubAuthExchange(code: String!, state: String!): AuthPayload!
    tokenRefresh(refreshToken: String!): AuthPayload!
    logout: LogoutPayload!

    organizationCreate(input: OrganizationCreateInput!): EnterOrganizationPayload!
    """
    Re-issue the session against another organization the viewer belongs to.
    Returns fresh tokens the client installs before navigating.
    """
    organizationSwitch(organizationId: ID!): EnterOrganizationPayload!

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

    organizationMemberUpdateRole(userId: ID!, role: OrganizationRole!): DeletePayload!
    """Remove a member from the current organization, along with their team memberships."""
    organizationMemberRemove(userId: ID!): DeletePayload!
    """
    Give up your own membership in the current organization, along with your
    team memberships inside it. Any member may leave; the last owner may not,
    since that strands the workspace with nobody able to manage it. Separate
    from organizationMemberRemove, which refuses self-removal on purpose.
    """
    organizationLeave: LeaveOrganizationPayload!
    organizationInviteCreate(email: String!, role: OrganizationRole!): OrganizationInvitePayload!
    organizationInviteRevoke(id: ID!): BasicPayload!
    """Claim an invitation. Requires a signed-in session whose email matches it."""
    organizationInviteAccept(token: String!): EnterOrganizationPayload!

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

    # Persist the user's language preference (used to localize transactional
    # emails, which have no access to the browser locale cookie).
    userUpdateLocale(locale: String!): UserPayload!

    # Persist the user's accent-colour preference. The running app reads the
    # accent cookie; this is stored so the choice follows the account to a new
    # browser or device (the session route seeds the cookie from it at login).
    userUpdateAccent(accent: String!): UserPayload!

    # Rotate the per-user iCal feed token. Returns the updated user so the
    # caller can immediately display the new feed URL.
    userCalendarFeedTokenRotate: UserPayload!

    # SAML SSO configuration — owner/admin only
    samlConfigurationSave(input: SamlConfigurationInput!): SamlConfigurationPayload!
    samlConfigurationDelete: SamlDeletePayload!

    # SCIM provisioning token management — admin only
    scimTokenCreate(label: String!): ScimTokenCreatePayload!
    scimTokenRevoke(id: ID!): ScimTokenRevokePayload!

    """Create a personal API key. scopes defaults to [read, write]; expiresInDays defaults to 365 (1-3650)."""
    apiTokenCreate(label: String!, scopes: [String!], expiresInDays: Int): ApiTokenCreatePayload!
    apiTokenRevoke(id: ID!): BasicPayload!

    # ------------------------------------------------------------------
    # Platform admin console (cross-tenant) — every mutation requires the
    # caller to carry User.isPlatformAdmin. Impersonation start/stop are
    # handled by dedicated API routes (/api/admin/impersonate[/stop]) because
    # they must rewrite the session cookie server-side.
    #
    # These deliberately DON'T follow the usual { success, entity, lastSyncId }
    # mutation envelope: they act across tenants, so there is no single org to
    # scope a SyncAction to, and no lastSyncId to return. Like webhooks/SAML
    # (also SyncAction-exempt), they return the affected entity directly.
    # ------------------------------------------------------------------
    platformTenantSuspend(id: ID!, reason: String): PlatformTenant!
    platformTenantRestore(id: ID!): PlatformTenant!
    """Soft-delete a tenant (sets archivedAt). Members lose access; data is retained."""
    platformTenantDelete(id: ID!): PlatformTenant!
    """Overwrite a tenant's per-org plan-tier caps. Returns the updated tenant detail."""
    platformTenantUpdateLimits(id: ID!, limits: OrganizationPlanLimitsInput!): PlatformTenantDetail!
    platformUserSuspend(id: ID!): PlatformUser!
    platformUserReactivate(id: ID!): PlatformUser!
    platformUserSetAdmin(id: ID!, isPlatformAdmin: Boolean!): PlatformUser!
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

  type ApiToken {
    id: ID!
    label: String!
    """Permission scopes. Empty = full access (legacy key). Values: read, write."""
    scopes: [String!]!
    lastUsedAt: DateTime
    createdAt: DateTime!
    expiresAt: DateTime!
  }

  type ApiTokenCreatePayload {
    plaintext: String!
    success: Boolean!
    token: ApiToken!
  }

  # ---------------------------------------------------------------------------
  # Platform admin console (cross-tenant)
  # ---------------------------------------------------------------------------

  type PlatformTopOrg {
    id: ID!
    name: String!
    urlKey: String!
    issueCount: Int!
    memberCount: Int!
  }

  type PlatformMetrics {
    totalOrgs: Int!
    activeOrgs: Int!
    suspendedOrgs: Int!
    totalUsers: Int!
    activeUsers: Int!
    suspendedUsers: Int!
    platformAdmins: Int!
    totalIssues: Int!
    newUsers7d: Int!
    newUsers30d: Int!
    newOrgs7d: Int!
    newOrgs30d: Int!
    topOrgs: [PlatformTopOrg!]!
  }

  type PlatformTenant {
    id: ID!
    name: String!
    urlKey: String!
    logoUrl: String
    dataRegion: String!
    suspendedAt: DateTime
    suspendedReason: String
    archivedAt: DateTime
    createdAt: DateTime!
    memberCount: Int!
    issueCount: Int!
  }

  type PlatformTenantOwner {
    id: ID!
    email: String!
    displayName: String!
  }

  type PlatformTenantDetail {
    id: ID!
    name: String!
    urlKey: String!
    logoUrl: String
    dataRegion: String!
    suspendedAt: DateTime
    suspendedReason: String
    archivedAt: DateTime
    createdAt: DateTime!
    memberCount: Int!
    issueCount: Int!
    teamCount: Int!
    projectCount: Int!
    owners: [PlatformTenantOwner!]!
    limits: OrganizationPlanLimits!
  }

  type PlatformUserOrg {
    id: ID!
    name: String!
    urlKey: String!
    role: OrganizationRole!
  }

  type PlatformUser {
    id: ID!
    email: String!
    displayName: String!
    active: Boolean!
    isPlatformAdmin: Boolean!
    lastSeen: DateTime
    createdAt: DateTime!
    organizations: [PlatformUserOrg!]!
  }

  """
  Lean projection of the acting admin. Deliberately NOT the full User type:
  the audit query only selects id/email/displayName, so exposing it as User
  would let a client request non-null User fields (active, avatar, …) that
  aren't loaded and error the whole response.
  """
  type PlatformAuditActor {
    id: ID!
    email: String!
    displayName: String!
  }

  type PlatformAuditLogEntry {
    id: ID!
    action: String!
    targetType: String
    targetId: ID
    metadata: JSON
    ipAddress: String
    createdAt: DateTime!
    actor: PlatformAuditActor
  }

  type PlatformAuditLogPage {
    entries: [PlatformAuditLogEntry!]!
    hasMore: Boolean!
    nextCursor: String
  }

  type ImpersonationState {
    active: Boolean!
    adminEmail: String
    adminName: String
  }
`;
