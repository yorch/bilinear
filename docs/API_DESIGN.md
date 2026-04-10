# API Design Document

## Issue Tracker — Linear Rebuild

**Version:** 1.0
**Date:** April 2026
**Protocol:** GraphQL over HTTP + WebSocket

---

## 1. API Overview

| Aspect     | Design                                                    |
| ---------- | --------------------------------------------------------- |
| Protocol   | GraphQL                                                   |
| Endpoint   | `POST /api/graphql`                                       |
| Auth       | Bearer token (JWT) or API key                             |
| Pagination | Relay cursor-based                                        |
| Real-time  | WebSocket (`/ws`)                                         |
| Sync       | REST endpoints (`/api/sync/bootstrap`, `/api/sync/delta`) |
| Rate Limit | 5,000 req/hr + 250,000 complexity points/hr               |

---

## 2. Authentication

### Headers

```text
Authorization: Bearer <jwt_token>
Authorization: lin_api_<api_key>
```

### Auth Mutations

```graphql
type Mutation {
  # Email magic link login
  emailLogin(input: EmailLoginInput!): EmailLoginPayload!

  # Verify magic link code
  emailVerify(input: EmailVerifyInput!): AuthPayload!

  # Google OAuth exchange
  googleAuthExchange(code: String!, redirectUri: String!): AuthPayload!

  # Refresh access token
  tokenRefresh(refreshToken: String!): AuthPayload!

  # Logout (revoke tokens)
  logout: LogoutPayload!

  # API key management
  apiKeyCreate(input: ApiKeyCreateInput!): ApiKeyPayload!
  apiKeyDelete(id: ID!): DeletePayload!
}

input EmailLoginInput {
  email: String!
}

input EmailVerifyInput {
  email: String!
  code: String!
}

type AuthPayload {
  success: Boolean!
  accessToken: String!
  refreshToken: String!
  expiresIn: Int!  # seconds (86400 = 24h)
  user: User!
}
```

---

## 3. Core Schema Types

### 3.1 Interfaces

```graphql
interface Node {
  id: ID!
}

interface Entity implements Node {
  id: ID!
  createdAt: DateTime!
  updatedAt: DateTime!
  archivedAt: DateTime
}
```

### 3.2 Scalars

```graphql
scalar DateTime      # ISO 8601 (2026-04-06T12:00:00.000Z)
scalar TimelessDate  # YYYY-MM-DD
scalar JSON
scalar JSONObject
scalar UUID
```

### 3.3 Pagination Types

```graphql
type PageInfo {
  hasNextPage: Boolean!
  hasPreviousPage: Boolean!
  startCursor: String
  endCursor: String
}

enum PaginationOrderBy {
  createdAt
  updatedAt
}

# Example connection (pattern repeated for all entities)
type IssueConnection {
  edges: [IssueEdge!]!
  nodes: [Issue!]!
  pageInfo: PageInfo!
  totalCount: Int!
}

type IssueEdge {
  cursor: String!
  node: Issue!
}
```

---

## 4. Entity Types

### 4.1 Organization

```graphql
type Organization implements Entity & Node {
  id: ID!
  name: String!
  urlKey: String!
  logoUrl: String
  dataRegion: String!
  userCount: Int!
  createdIssueCount: Int!

  # Feature flags
  roadmapEnabled: Boolean!
  customersEnabled: Boolean!
  initiativesEnabled: Boolean!

  # Settings
  projectUpdateFrequencyWeeks: Int
  fiscalYearStartMonth: Int!

  # Connections
  teams(first: Int, after: String): TeamConnection!
  users(first: Int, after: String): UserConnection!
  labels(first: Int, after: String): IssueLabelConnection!
  templates(first: Int, after: String): TemplateConnection!
  integrations(first: Int, after: String): IntegrationConnection!

  createdAt: DateTime!
  updatedAt: DateTime!
  archivedAt: DateTime
}
```

### 4.2 User

```graphql
type User implements Entity & Node {
  id: ID!
  name: String!
  displayName: String!
  email: String!
  initials: String!
  avatarUrl: String
  avatarBackgroundColor: String!

  active: Boolean!
  admin: Boolean!
  guest: Boolean!
  owner: Boolean!
  isMe: Boolean!

  timezone: String
  lastSeen: DateTime
  statusEmoji: String
  statusLabel: String
  statusUntilAt: DateTime

  createdIssueCount: Int!
  organization: Organization!

  # Connections
  assignedIssues(filter: IssueFilter, first: Int, after: String): IssueConnection!
  createdIssues(filter: IssueFilter, first: Int, after: String): IssueConnection!
  teams(first: Int, after: String): TeamConnection!
  teamMemberships(first: Int, after: String): TeamMembershipConnection!

  createdAt: DateTime!
  updatedAt: DateTime!
}
```

### 4.3 Team

```graphql
type Team implements Entity & Node {
  id: ID!
  name: String!
  key: String!
  displayName: String!
  description: String
  icon: String
  color: String
  private: Boolean!
  timezone: String!

  organization: Organization!
  parent: Team
  children: [Team!]!

  # Cycle config
  cyclesEnabled: Boolean!
  cycleDuration: Int
  cycleCooldownTime: Int
  cycleStartDay: Int

  # Estimation config
  issueEstimationType: String!
  issueEstimationExtended: Boolean!
  issueEstimationAllowZero: Boolean!

  # Triage
  triageEnabled: Boolean!

  # Defaults
  defaultIssueState: WorkflowState
  issueCount: Int!

  # Active cycle
  activeCycle: Cycle

  # Connections
  issues(filter: IssueFilter, first: Int, after: String, orderBy: PaginationOrderBy, includeArchived: Boolean): IssueConnection!
  states(first: Int, after: String): WorkflowStateConnection!
  labels(first: Int, after: String): IssueLabelConnection!
  members(first: Int, after: String): UserConnection!
  memberships(first: Int, after: String): TeamMembershipConnection!
  cycles(filter: CycleFilter, first: Int, after: String): CycleConnection!
  projects(filter: ProjectFilter, first: Int, after: String): ProjectConnection!
  templates(first: Int, after: String): TemplateConnection!
  webhooks(first: Int, after: String): WebhookConnection!

  createdAt: DateTime!
  updatedAt: DateTime!
  archivedAt: DateTime
}
```

### 4.4 Issue

```graphql
type Issue implements Entity & Node {
  id: ID!

  # Identity
  identifier: String!       # "ENG-123"
  number: Int!
  url: String!
  previousIdentifiers: [String!]!
  branchName: String!

  # Content
  title: String!
  description: String
  descriptionState: String   # YJS base64

  # Properties
  priority: Int!             # 0=None, 1=Urgent, 2=High, 3=Medium, 4=Low
  priorityLabel: String!     # "Urgent", "High", etc.
  estimate: Float
  dueDate: TimelessDate
  sortOrder: Float!
  prioritySortOrder: Float!
  subIssueSortOrder: Float

  # Relationships
  team: Team!
  state: WorkflowState!
  assignee: User
  creator: User
  parent: Issue
  project: Project
  projectMilestone: ProjectMilestone
  cycle: Cycle

  # Label IDs (denormalized for performance)
  labelIds: [String!]!

  # SLA
  slaBreachesAt: DateTime
  slaStartedAt: DateTime
  slaType: String

  # Lifecycle
  startedAt: DateTime
  completedAt: DateTime
  canceledAt: DateTime
  trashed: Boolean!
  snoozedUntilAt: DateTime
  snoozedBy: User

  customerTicketCount: Int!

  # Connections
  labels(first: Int, after: String): IssueLabelConnection!
  children(filter: IssueFilter, first: Int, after: String): IssueConnection!
  comments(first: Int, after: String): CommentConnection!
  attachments(first: Int, after: String): AttachmentConnection!
  relations(first: Int, after: String): IssueRelationConnection!
  inverseRelations(first: Int, after: String): IssueRelationConnection!
  history(first: Int, after: String): IssueHistoryConnection!
  subscribers(first: Int, after: String): UserConnection!
  reactions: [Reaction!]!

  # Favorites
  favorite: Favorite

  createdAt: DateTime!
  updatedAt: DateTime!
  archivedAt: DateTime
}
```

### 4.5 WorkflowState

```graphql
type WorkflowState implements Entity & Node {
  id: ID!
  name: String!
  color: String!
  description: String
  type: String!      # "triage" | "backlog" | "unstarted" | "started" | "completed" | "canceled"
  position: Float!
  team: Team!

  issues(filter: IssueFilter, first: Int, after: String): IssueConnection!

  createdAt: DateTime!
  updatedAt: DateTime!
  archivedAt: DateTime
}
```

### 4.6 Project

```graphql
type Project implements Entity & Node {
  id: ID!
  name: String!
  slugId: String!
  url: String!
  description: String!
  content: String
  icon: String
  color: String!

  # Status & Health
  status: ProjectStatus!
  health: String           # "onTrack" | "atRisk" | "offTrack"
  healthUpdatedAt: DateTime

  # Priority
  priority: Int!
  priorityLabel: String!

  # Progress
  progress: Float!
  scope: Float!

  # Dates
  startDate: TimelessDate
  targetDate: TimelessDate
  startDateResolution: String
  targetDateResolution: String

  # People
  lead: User
  creator: User

  # Lifecycle
  startedAt: DateTime
  completedAt: DateTime
  canceledAt: DateTime
  trashed: Boolean!

  # History data (for charts)
  completedIssueCountHistory: JSON!
  completedScopeHistory: JSON!
  issueCountHistory: JSON!
  scopeHistory: JSON!

  # Connections
  issues(filter: IssueFilter, first: Int, after: String): IssueConnection!
  members(first: Int, after: String): UserConnection!
  teams(first: Int, after: String): TeamConnection!
  milestones(first: Int, after: String): ProjectMilestoneConnection!
  projectUpdates(first: Int, after: String): ProjectUpdateConnection!
  documents(first: Int, after: String): DocumentConnection!
  labels(first: Int, after: String): IssueLabelConnection!

  createdAt: DateTime!
  updatedAt: DateTime!
  archivedAt: DateTime
}
```

### 4.7 Other Entity Types (abbreviated)

```graphql
type Cycle implements Entity & Node {
  id: ID!
  name: String
  number: Int!
  description: String
  startsAt: DateTime!
  endsAt: DateTime!
  completedAt: DateTime
  isActive: Boolean!
  isFuture: Boolean!
  isPast: Boolean!
  progress: Float!
  scope: Float!
  team: Team!
  issues(filter: IssueFilter, first: Int, after: String): IssueConnection!
  # ... history fields
  createdAt: DateTime!
  updatedAt: DateTime!
  archivedAt: DateTime
}

type Comment implements Entity & Node {
  id: ID!
  body: String!
  bodyData: JSONObject
  user: User
  botActor: JSONObject
  issue: Issue
  project: Project
  parent: Comment
  children(first: Int, after: String): CommentConnection!
  resolvedAt: DateTime
  resolvingUser: User
  quotedText: String
  reactions: [Reaction!]!
  editedAt: DateTime
  createdAt: DateTime!
  updatedAt: DateTime!
  archivedAt: DateTime
}

type IssueRelation implements Entity & Node {
  id: ID!
  issue: Issue!
  relatedIssue: Issue!
  type: String!  # "related" | "blocks" | "duplicate"
  createdAt: DateTime!
  updatedAt: DateTime!
}

type IssueLabel implements Entity & Node {
  id: ID!
  name: String!
  color: String!
  description: String
  isGroup: Boolean!
  parent: IssueLabel
  children(first: Int, after: String): IssueLabelConnection!
  team: Team
  creator: User
  issues(first: Int, after: String): IssueConnection!
  createdAt: DateTime!
  updatedAt: DateTime!
  archivedAt: DateTime
}

type Attachment implements Entity & Node {
  id: ID!
  title: String!
  subtitle: String
  url: String!
  sourceType: String
  source: JSONObject
  metadata: JSONObject
  issue: Issue!
  creator: User
  createdAt: DateTime!
  updatedAt: DateTime!
  archivedAt: DateTime
}

type Notification implements Entity & Node {
  id: ID!
  type: String!
  user: User!
  actor: User
  issue: Issue
  comment: Comment
  project: Project
  readAt: DateTime
  snoozedUntilAt: DateTime
  emailedAt: DateTime
  createdAt: DateTime!
  updatedAt: DateTime!
  archivedAt: DateTime
}

type Favorite implements Entity & Node {
  id: ID!
  type: String!
  title: String!
  sortOrder: Float!
  icon: String
  color: String
  owner: User!
  parent: Favorite
  children(first: Int, after: String): FavoriteConnection!
  folderName: String
  issue: Issue
  project: Project
  cycle: Cycle
  customView: CustomView
  label: IssueLabel
  predefinedViewType: String
  predefinedViewTeam: Team
  createdAt: DateTime!
  updatedAt: DateTime!
}

type CustomView implements Entity & Node {
  id: ID!
  name: String!
  description: String
  icon: String
  color: String
  filterData: JSONObject!
  displayType: String!     # "list" | "board" | "timeline"
  groupBy: String
  sortBy: JSONObject
  columns: [String!]
  creator: User!
  owner: User!
  team: Team
  shared: Boolean!
  createdAt: DateTime!
  updatedAt: DateTime!
  archivedAt: DateTime
}

type IssueHistory implements Node {
  id: ID!
  issue: Issue!
  actor: User
  fromState: WorkflowState
  toState: WorkflowState
  fromAssignee: User
  toAssignee: User
  fromPriority: Int
  toPriority: Int
  fromEstimate: Float
  toEstimate: Float
  fromDueDate: TimelessDate
  toDueDate: TimelessDate
  fromTitle: String
  toTitle: String
  fromProject: Project
  toProject: Project
  fromCycle: Cycle
  toCycle: Cycle
  fromParent: Issue
  toParent: Issue
  fromTeam: Team
  toTeam: Team
  addedLabelIds: [String!]
  removedLabelIds: [String!]
  archived: Boolean
  trashed: Boolean
  createdAt: DateTime!
}

type Initiative implements Entity & Node {
  id: ID!
  name: String!
  slugId: String!
  url: String!
  description: String
  content: String
  icon: String
  color: String
  status: String!          # "planned" | "active" | "completed"
  health: String
  targetDate: TimelessDate
  owner: User
  creator: User
  parent: Initiative
  projects(first: Int, after: String): ProjectConnection!
  documents(first: Int, after: String): DocumentConnection!
  createdAt: DateTime!
  updatedAt: DateTime!
  archivedAt: DateTime
}

type Document implements Entity & Node {
  id: ID!
  title: String!
  slugId: String!
  url: String!
  content: String
  icon: String
  color: String
  creator: User
  updatedBy: User
  project: Project
  initiative: Initiative
  issue: Issue
  team: Team
  trashed: Boolean!
  comments(first: Int, after: String): CommentConnection!
  createdAt: DateTime!
  updatedAt: DateTime!
  archivedAt: DateTime
}

type Template implements Entity & Node {
  id: ID!
  name: String!
  type: String!
  description: String
  icon: String
  color: String
  templateData: JSON!
  hasFormFields: Boolean!
  team: Team
  creator: User
  createdAt: DateTime!
  updatedAt: DateTime!
  archivedAt: DateTime
}

type Webhook implements Entity & Node {
  id: ID!
  url: String!
  label: String
  enabled: Boolean!
  allPublicTeams: Boolean!
  resourceTypes: [String!]!
  team: Team
  creator: User
  createdAt: DateTime!
  updatedAt: DateTime!
  archivedAt: DateTime
}

type ProjectStatus {
  id: ID!
  name: String!
  color: String!
  type: String!     # "backlog" | "planned" | "started" | "paused" | "completed" | "canceled"
  position: Float!
  description: String
}

type ProjectMilestone implements Entity & Node {
  id: ID!
  name: String!
  description: String
  targetDate: TimelessDate
  sortOrder: Float!
  progress: Float!
  project: Project!
  issues(first: Int, after: String): IssueConnection!
  createdAt: DateTime!
  updatedAt: DateTime!
  archivedAt: DateTime
}

type ProjectUpdate implements Entity & Node {
  id: ID!
  body: String!
  bodyData: JSONObject!
  health: String!    # "onTrack" | "atRisk" | "offTrack"
  project: Project!
  user: User!
  editedAt: DateTime
  diff: JSONObject
  diffMarkdown: String
  reactions: [Reaction!]!
  comments(first: Int, after: String): CommentConnection!
  createdAt: DateTime!
  updatedAt: DateTime!
  archivedAt: DateTime
}

type Reaction {
  id: ID!
  emoji: String!
  user: User
  createdAt: DateTime!
}

type TeamMembership implements Entity & Node {
  id: ID!
  team: Team!
  user: User!
  owner: Boolean!
  sortOrder: Float!
  createdAt: DateTime!
  updatedAt: DateTime!
}
```

---

## 5. Queries

```graphql
type Query {
  # Viewer (authenticated user)
  viewer: User!
  organization: Organization!

  # Single entity lookups (support both UUID and identifier like "ENG-123")
  issue(id: ID!): Issue!
  project(id: ID!): Project!
  team(id: ID!): Team!
  cycle(id: ID!): Cycle!
  comment(id: ID!): Comment!
  customView(id: ID!): CustomView!
  document(id: ID!): Document!
  initiative(id: ID!): Initiative!
  template(id: ID!): Template!

  # Paginated lists with filters
  issues(
    filter: IssueFilter
    first: Int
    after: String
    last: Int
    before: String
    orderBy: PaginationOrderBy
    includeArchived: Boolean
  ): IssueConnection!

  projects(
    filter: ProjectFilter
    first: Int
    after: String
    orderBy: PaginationOrderBy
    includeArchived: Boolean
  ): ProjectConnection!

  teams(first: Int, after: String): TeamConnection!
  cycles(filter: CycleFilter, first: Int, after: String): CycleConnection!
  users(filter: UserFilter, first: Int, after: String): UserConnection!
  labels(filter: LabelFilter, first: Int, after: String): IssueLabelConnection!
  templates(first: Int, after: String): TemplateConnection!
  customViews(first: Int, after: String): CustomViewConnection!
  favorites(first: Int, after: String): FavoriteConnection!
  notifications(first: Int, after: String): NotificationConnection!
  documents(first: Int, after: String): DocumentConnection!
  initiatives(first: Int, after: String): InitiativeConnection!
  webhooks(first: Int, after: String): WebhookConnection!

  # Search
  searchIssues(query: String!, first: Int, includeArchived: Boolean): IssueConnection!
  searchProjects(query: String!, first: Int): ProjectConnection!
  searchDocuments(query: String!, first: Int): DocumentConnection!

  # Audit (Enterprise)
  auditEntries(
    filter: AuditEntryFilter
    first: Int
    after: String
  ): AuditEntryConnection!
}
```

---

## 6. Mutations

```graphql
type Mutation {
  # Issues
  issueCreate(input: IssueCreateInput!): IssuePayload!
  issueUpdate(id: ID!, input: IssueUpdateInput!): IssuePayload!
  issueArchive(id: ID!): IssuePayload!
  issueUnarchive(id: ID!): IssuePayload!
  issueDelete(id: ID!): DeletePayload!

  # Comments
  commentCreate(input: CommentCreateInput!): CommentPayload!
  commentUpdate(id: ID!, input: CommentUpdateInput!): CommentPayload!
  commentDelete(id: ID!): DeletePayload!

  # Issue Relations
  issueRelationCreate(input: IssueRelationCreateInput!): IssueRelationPayload!
  issueRelationDelete(id: ID!): DeletePayload!

  # Labels
  issueLabelCreate(input: IssueLabelCreateInput!): IssueLabelPayload!
  issueLabelUpdate(id: ID!, input: IssueLabelUpdateInput!): IssueLabelPayload!
  issueLabelArchive(id: ID!): IssueLabelPayload!

  # Projects
  projectCreate(input: ProjectCreateInput!): ProjectPayload!
  projectUpdate(id: ID!, input: ProjectUpdateInput!): ProjectPayload!
  projectArchive(id: ID!): ProjectPayload!
  projectDelete(id: ID!): DeletePayload!

  # Project Milestones
  projectMilestoneCreate(input: ProjectMilestoneCreateInput!): ProjectMilestonePayload!
  projectMilestoneUpdate(id: ID!, input: ProjectMilestoneUpdateInput!): ProjectMilestonePayload!
  projectMilestoneDelete(id: ID!): DeletePayload!

  # Project Updates
  projectUpdateCreate(input: ProjectUpdateCreateInput!): ProjectUpdatePayload!
  projectUpdateUpdate(id: ID!, input: ProjectUpdateUpdateInput!): ProjectUpdatePayload!
  projectUpdateDelete(id: ID!): DeletePayload!

  # Cycles
  cycleCreate(input: CycleCreateInput!): CyclePayload!
  cycleUpdate(id: ID!, input: CycleUpdateInput!): CyclePayload!
  cycleArchive(id: ID!): CyclePayload!

  # Teams
  teamCreate(input: TeamCreateInput!): TeamPayload!
  teamUpdate(id: ID!, input: TeamUpdateInput!): TeamPayload!
  teamDelete(id: ID!): DeletePayload!

  # Team Membership
  teamMembershipCreate(input: TeamMembershipCreateInput!): TeamMembershipPayload!
  teamMembershipUpdate(id: ID!, input: TeamMembershipUpdateInput!): TeamMembershipPayload!
  teamMembershipDelete(id: ID!): DeletePayload!

  # Workflow States
  workflowStateCreate(input: WorkflowStateCreateInput!): WorkflowStatePayload!
  workflowStateUpdate(id: ID!, input: WorkflowStateUpdateInput!): WorkflowStatePayload!
  workflowStateArchive(id: ID!): WorkflowStatePayload!

  # Initiatives
  initiativeCreate(input: InitiativeCreateInput!): InitiativePayload!
  initiativeUpdate(id: ID!, input: InitiativeUpdateInput!): InitiativePayload!
  initiativeArchive(id: ID!): InitiativePayload!

  # Documents
  documentCreate(input: DocumentCreateInput!): DocumentPayload!
  documentUpdate(id: ID!, input: DocumentUpdateInput!): DocumentPayload!
  documentDelete(id: ID!): DeletePayload!

  # Templates
  templateCreate(input: TemplateCreateInput!): TemplatePayload!
  templateUpdate(id: ID!, input: TemplateUpdateInput!): TemplatePayload!
  templateDelete(id: ID!): DeletePayload!

  # Custom Views
  customViewCreate(input: CustomViewCreateInput!): CustomViewPayload!
  customViewUpdate(id: ID!, input: CustomViewUpdateInput!): CustomViewPayload!
  customViewDelete(id: ID!): DeletePayload!

  # Favorites
  favoriteCreate(input: FavoriteCreateInput!): FavoritePayload!
  favoriteUpdate(id: ID!, input: FavoriteUpdateInput!): FavoritePayload!
  favoriteDelete(id: ID!): DeletePayload!

  # Notifications
  notificationUpdate(id: ID!, input: NotificationUpdateInput!): NotificationPayload!
  notificationArchive(id: ID!): NotificationPayload!
  notificationMarkAllRead: NotificationBatchPayload!
  notificationSnooze(id: ID!, snoozedUntilAt: DateTime!): NotificationPayload!

  # Reactions
  reactionCreate(input: ReactionCreateInput!): ReactionPayload!
  reactionDelete(id: ID!): DeletePayload!

  # Attachments
  attachmentCreate(input: AttachmentCreateInput!): AttachmentPayload!
  attachmentUpdate(id: ID!, input: AttachmentUpdateInput!): AttachmentPayload!
  attachmentDelete(id: ID!): DeletePayload!

  # File upload
  fileUpload(contentType: String!, filename: String!, size: Int!): UploadPayload!

  # Webhooks
  webhookCreate(input: WebhookCreateInput!): WebhookPayload!
  webhookUpdate(id: ID!, input: WebhookUpdateInput!): WebhookPayload!
  webhookDelete(id: ID!): DeletePayload!

  # Organization
  organizationUpdate(input: OrganizationUpdateInput!): OrganizationPayload!

  # User
  userUpdate(id: ID!, input: UserUpdateInput!): UserPayload!
  userSettingsUpdate(input: UserSettingsUpdateInput!): UserSettingsPayload!

  # Auth (see Section 2)
  emailLogin(input: EmailLoginInput!): EmailLoginPayload!
  emailVerify(input: EmailVerifyInput!): AuthPayload!
  googleAuthExchange(code: String!, redirectUri: String!): AuthPayload!
  tokenRefresh(refreshToken: String!): AuthPayload!
  logout: LogoutPayload!
  apiKeyCreate(input: ApiKeyCreateInput!): ApiKeyPayload!
  apiKeyDelete(id: ID!): DeletePayload!
}
```

---

## 7. Input Types (Key Examples)

```graphql
input IssueCreateInput {
  id: String              # Client-generated UUID (for offline-first)
  title: String!
  description: String
  teamId: String!
  stateId: String
  assigneeId: String
  priority: Int
  estimate: Float
  dueDate: TimelessDate
  labelIds: [String!]
  projectId: String
  projectMilestoneId: String
  cycleId: String
  parentId: String
  templateId: String
  sortOrder: Float
}

input IssueUpdateInput {
  title: String
  description: String
  stateId: String
  assigneeId: String
  priority: Int
  estimate: Float
  dueDate: TimelessDate
  labelIds: [String!]
  projectId: String
  projectMilestoneId: String
  cycleId: String
  parentId: String
  sortOrder: Float
  prioritySortOrder: Float
  subIssueSortOrder: Float
  trashed: Boolean
  snoozedUntilAt: DateTime
  snoozedById: String
}

input CommentCreateInput {
  id: String
  body: String!
  bodyData: JSONObject
  issueId: String
  projectId: String
  projectUpdateId: String
  parentId: String
}

input ProjectCreateInput {
  id: String
  name: String!
  description: String
  icon: String
  color: String
  statusType: String
  leadId: String
  startDate: TimelessDate
  targetDate: TimelessDate
  teamIds: [String!]!
  memberIds: [String!]
}
```

---

## 8. Filter System

```graphql
# String comparators
input StringComparator {
  eq: String
  neq: String
  in: [String!]
  nin: [String!]
  contains: String
  notContains: String
  startsWith: String
  endsWith: String
  containsIgnoreCase: String
}

# Number comparators
input NumberComparator {
  eq: Float
  neq: Float
  in: [Float!]
  nin: [Float!]
  lt: Float
  lte: Float
  gt: Float
  gte: Float
}

# Date comparators
input DateComparator {
  eq: DateTime
  neq: DateTime
  lt: DateTime
  lte: DateTime
  gt: DateTime
  gte: DateTime
}

# Nullable filter
input NullableFilter {
  null: Boolean
}

# Issue filter (composable with AND/OR)
input IssueFilter {
  # Entity filters
  id: StringComparator
  title: StringComparator
  description: StringComparator
  number: NumberComparator

  # Relationship filters (nested)
  team: TeamFilter
  state: WorkflowStateFilter
  assignee: UserFilter
  creator: UserFilter
  project: ProjectFilter
  cycle: CycleFilter
  parent: IssueFilter
  labels: IssueLabelFilter

  # Property filters
  priority: NumberComparator
  estimate: NumberComparator
  dueDate: DateComparator

  # Timestamp filters
  createdAt: DateComparator
  updatedAt: DateComparator
  completedAt: DateComparator
  canceledAt: DateComparator
  startedAt: DateComparator

  # Boolean filters
  trashed: Boolean

  # SLA
  slaStatus: StringComparator

  # Relation existence
  hasBlockedByRelations: Boolean
  hasBlockingRelations: Boolean
  hasDuplicateRelations: Boolean

  # Content search
  searchableContent: StringComparator

  # Composition
  and: [IssueFilter!]
  or: [IssueFilter!]
}

input WorkflowStateFilter {
  id: StringComparator
  name: StringComparator
  type: StringComparator
}

input TeamFilter {
  id: StringComparator
  name: StringComparator
  key: StringComparator
}

input UserFilter {
  id: StringComparator
  name: StringComparator
  email: StringComparator
  active: Boolean
  isMe: Boolean
}

input ProjectFilter {
  id: StringComparator
  name: StringComparator
  statusType: StringComparator
  health: StringComparator
  leadId: StringComparator
  startDate: DateComparator
  targetDate: DateComparator
}

input CycleFilter {
  id: StringComparator
  name: StringComparator
  isActive: Boolean
  isFuture: Boolean
  isPast: Boolean
  startsAt: DateComparator
  endsAt: DateComparator
}

input IssueLabelFilter {
  id: StringComparator
  name: StringComparator
}

input LabelFilter {
  id: StringComparator
  name: StringComparator
  teamId: StringComparator
}
```

---

## 9. Mutation Payloads

```graphql
# Standard payload pattern
type IssuePayload {
  success: Boolean!
  issue: Issue
  lastSyncId: String!  # For sync engine; String to avoid 32-bit int overflow
}

type DeletePayload {
  success: Boolean!
  lastSyncId: String!
}

# Pattern repeated for all entities:
type CommentPayload { success: Boolean!, comment: Comment, lastSyncId: String! }
type ProjectPayload { success: Boolean!, project: Project, lastSyncId: String! }
type CyclePayload { success: Boolean!, cycle: Cycle, lastSyncId: String! }
type TeamPayload { success: Boolean!, team: Team, lastSyncId: String! }
type WorkflowStatePayload { success: Boolean!, workflowState: WorkflowState, lastSyncId: String! }
type IssueLabelPayload { success: Boolean!, issueLabel: IssueLabel, lastSyncId: String! }
type FavoritePayload { success: Boolean!, favorite: Favorite, lastSyncId: String! }
type NotificationPayload { success: Boolean!, notification: Notification, lastSyncId: String! }
type NotificationBatchPayload { success: Boolean!, lastSyncId: String! }
type CustomViewPayload { success: Boolean!, customView: CustomView, lastSyncId: String! }
# ... etc.
```

---

## 10. Sync Endpoints (REST)

These complement the GraphQL API for the sync engine:

```
GET /sync/bootstrap?type=full&onlyModels=Issue,Team,User,...
  → Content-Type: text/plain
  → Body: line-delimited ModelName=<JSON>\n
  → Last line: _metadata_={"lastSyncId": 12345, "method": "postgres"}

GET /sync/bootstrap?type=partial&onlyModels=Comment,IssueHistory
  → Same format as full

GET /sync/delta?lastSyncId=12300&toSyncId=12345
  → Content-Type: application/json
  → Body: { "actions": [SyncAction, ...], "lastSyncId": 12345 }
```

---

## 11. WebSocket Protocol

```
Connection: wss://api.example.com/ws
  Headers: Authorization: Bearer <token>

Server → Client messages:
  { "cmd": "sync", "sync": [SyncAction, ...], "lastSyncId": N }
  { "cmd": "ping" }

Client → Server messages:
  { "cmd": "pong" }
  { "cmd": "subscribe", "channels": ["org:<orgId>"] }
```

---

## 12. Rate Limiting

```text
Response headers:
  X-RateLimit-Requests-Limit: 5000
  X-RateLimit-Requests-Remaining: 4999
  X-RateLimit-Requests-Reset: 1712400000
  X-Complexity: 14
  X-RateLimit-Complexity-Limit: 250000
  X-RateLimit-Complexity-Remaining: 249986
  X-RateLimit-Complexity-Reset: 1712400000

Complexity calculation:
  - Each property: 0.1 points
  - Each object: 1 point
  - Connections: multiply child complexity by `first` argument (default 50)
  - Max single query: 10,000 points

Rate limit exceeded → HTTP 400 with:
  { "errors": [{ "extensions": { "code": "RATELIMITED" } }] }
```

---

## 13. Webhook Payloads

```json
{
  "action": "create",      // "create" | "update" | "remove"
  "type": "Issue",
  "actor": {
    "id": "uuid",
    "type": "user"
  },
  "createdAt": "2026-04-06T12:00:00.000Z",
  "data": { /* full serialized entity */ },
  "url": "https://app.example.com/team/issue/ENG-123",
  "updatedFrom": { /* previous values for changed fields (update only) */ },
  "webhookTimestamp": 1712404800000,
  "webhookId": "uuid"
}
```

**Headers:**

```
Linear-Delivery: <uuid>
Linear-Event: Issue
Linear-Signature: <hmac-sha256-hex>
Content-Type: application/json; charset=utf-8
User-Agent: IssueTracker-Webhook
```

**Retry policy:** 3 attempts at 1min, 1hr, 6hr. Must respond 200 within 5s.
