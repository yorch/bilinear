# API Design Document

## Issue Tracker — Linear Rebuild

**Version:** 2.0
**Date:** 2026-04-17
**Protocol:** GraphQL over HTTP + REST sync + WebSocket push
**Source of truth:** `src/server/graphql/schema.ts` — this document describes
the same API but with prose and grouping. When the two disagree, trust the
code. A section at the end lists planned-but-unshipped surface.

---

## 1. API Overview

| Aspect          | Implementation                                                                                                                                                                      |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GraphQL         | `POST /api/graphql` (Apollo Server v4 on a Next.js route handler)                                                                                                                   |
| Auth            | HTTP-only cookie pair (`access_token`, `refresh_token`) set by auth mutations. The WebSocket reads `access_token` from the query string.                                            |
| Session cookies | `POST /api/auth/session` installs the cookie pair from a GraphQL auth result; `GET` returns the current access token (for the WS handshake); `DELETE` clears both cookies (logout). |
| Pagination      | Relay-style `Connection` / `Edge` / `PageInfo` on `IssueConnection`, `IssueLabelConnection`, `ProjectConnection` only. All other list queries return plain `[T!]!`.                 |
| Sync bootstrap  | `GET /api/sync/bootstrap` (REST) — returns all entities the signed-in user can see, plus the current `lastSyncId`.                                                                  |
| Sync delta      | `GET /api/sync/delta?lastSyncId=<n>` (REST) — catches up missed SyncActions.                                                                                                        |
| Real-time push  | `ws://<host>:3001?token=<accessToken>` — server pushes `SyncAction` events; clients do **not** subscribe via GraphQL.                                                               |
| File upload     | `POST /api/upload` (multipart) — returns a `File` record; served via `/api/uploads/<key>`.                                                                                          |
| Rate limit      | Enforced at middleware level on `/api/graphql` and `/api/auth/*`. See §12.                                                                                                          |

> **No GraphQL subscriptions.** Real-time delivery is a side-channel over
> WebSocket, not `subscription` operations. Client mutations go via `fetch` to
> `/api/graphql` — there is no Apollo Client on the browser.

---

## 2. Authentication

### Magic link + Google OAuth

```graphql
type Query {
  googleAuthStart: GoogleAuthStartPayload!  # returns { url, state } — client redirects browser to url
}

type Mutation {
  emailLogin(input: EmailLoginInput!): EmailLoginPayload!   # send magic code
  emailVerify(input: EmailVerifyInput!): AuthPayload!       # verify 6-digit code
  googleAuthExchange(code: String!, state: String!): AuthPayload!  # state returned by googleAuthStart
  tokenRefresh(refreshToken: String!): AuthPayload!
  logout: LogoutPayload!

  organizationCreate(input: OrganizationCreateInput!): OrganizationCreatePayload!
}

input EmailLoginInput { email: String! }
input EmailVerifyInput { email: String!, code: String! }
input OrganizationCreateInput { name: String!, urlKey: String! }

type AuthPayload {
  success: Boolean!
  accessToken: String!
  refreshToken: String!
  expiresIn: Int!         # seconds; 86400 (24h) today
  user: User!
}

type OrganizationCreatePayload {
  success: Boolean!
  organization: Organization!
  accessToken: String!
  refreshToken: String!
  expiresIn: Int!
}

type EmailLoginPayload { success: Boolean! }
type LogoutPayload { success: Boolean! }
```

The server also sets HTTP-only cookies on every auth mutation so browser
sessions don't need to re-attach the tokens on every request; the `accessToken`
in the payload is there for the WebSocket handshake.

> **API keys, SSO, and SCIM are design targets, not shipped.** See §14.

---

## 3. Scalars and Shared Types

```graphql
scalar DateTime  # ISO 8601
scalar UUID      # UUID v4 string
scalar Date      # YYYY-MM-DD
scalar JSON      # arbitrary JSON for *Data fields and filters
```

Pagination helpers (from `src/server/graphql/types/pagination.ts`):

```graphql
type PageInfo {
  hasNextPage: Boolean!
  hasPreviousPage: Boolean!
  startCursor: String
  endCursor: String
}
```

### Mutation payload convention

Every mutation returns `{ success, <entity>?, lastSyncId }`. The `lastSyncId`
is the stringified `BIGINT` id of the freshly-written `SyncAction` — clients
feed it back into `/api/sync/delta` to catch up other tabs or devices.

Payloads in the live schema:

| Payload type                   | Entity field                              |
| ------------------------------ | ----------------------------------------- |
| `IssuePayload`                 | `issue`                                   |
| `IssueLabelPayload`            | `issueLabel`                              |
| `TeamPayload`                  | `team`                                    |
| `TeamMembershipPayload`        | `teamMembership`                          |
| `WorkflowStatePayload`         | `workflowState`                           |
| `ProjectPayload`               | `project`                                 |
| `ProjectMilestonePayload`      | `projectMilestone`                        |
| `ProjectUpdatePayload`         | `projectUpdate`                           |
| `CyclePayload`                 | `cycle`                                   |
| `CustomViewPayload`            | `customView`                              |
| `DocumentMutationResult`       | `document`                                |
| `CommentPayload`               | `comment`                                 |
| `CommentReactionPayload`       | `reaction`                                |
| `IssueReactionPayload`         | `reaction`                                |
| `InitiativeUpdatePayload`      | `initiativeUpdate`                        |
| `NotificationPayload`          | `notification`                            |
| `IssueRelationPayload`         | `issueRelation`                           |
| `IssueTemplatePayload`         | `issueTemplate`                           |
| `CustomFieldDefinitionPayload` | `customFieldDefinition`                   |
| `CustomFieldValuesPayload`     | `values: [CustomFieldValue!]!`            |
| `PublicRoadmapUpsertResult`    | `roadmap`                                 |
| `ProjectMutationResult`        | `project`                                 |
| `CycleRolloverPayload`         | `lastSyncId`, `movedCount`, `nextCycleId` |
| `DeletePayload`                | (no entity; `success` + `lastSyncId`)     |

### Error discriminator

Errors are thrown as `GraphQLError` with `extensions.code`. The resolver layer
catches service-layer exceptions and remaps them:

| Code              | When                                                       |
| ----------------- | ---------------------------------------------------------- |
| `UNAUTHENTICATED` | Missing / invalid access token                             |
| `FORBIDDEN`       | Authenticated but not authorized (wrong org, wrong role)   |
| `NOT_FOUND`       | Entity doesn't exist, or user can't see it                 |
| `BAD_USER_INPUT`  | Validation failure (service-level errors, Zod parse miss)  |
| `INVALID_CODE`    | Magic link code wrong / expired                            |
| `INVALID_TOKEN`   | Refresh token invalid / reused                             |
| `OAUTH_ERROR`     | Google OAuth token exchange failed or returned no identity |
| `RATELIMITED`     | Over the rate-limit budget (§12)                           |

Clients key off `extensions.code`, not the human-readable message.

---

## 4. Entity Types

All types are defined **inline** with their fields — there is no `Node` or
`Entity` interface today. Timestamps (`createdAt`, `updatedAt`, `archivedAt`)
are duplicated per type.

### 4.1 Organization

```graphql
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

type OrganizationMemberEntry { userId: ID!, role: String! }
```

Feature flags (`customersEnabled`, `initiativesEnabled`) live on the DB row
but aren't exposed via GraphQL yet.

### 4.2 User

```graphql
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
```

### 4.3 Team + TeamMembership + WorkflowState

```graphql
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
  issues: [Issue!]!   # plain array, not a connection
  createdAt: DateTime!
  updatedAt: DateTime!
  archivedAt: DateTime
}

enum TeamMemberRole { admin, member, guest }

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
  type: String!       # 'backlog' | 'unstarted' | 'started' | 'completed' | 'canceled' | 'triage'
  position: Float!
  team: Team!
  createdAt: DateTime!
  updatedAt: DateTime!
  archivedAt: DateTime
}
```

### 4.4 Issue + IssueLabel + IssueRelation + IssueActivity

```graphql
type Issue {
  id: ID!
  number: Int!
  identifier: String!           # e.g. ENG-123
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
  cycleId: ID
  organizationId: ID!
  branchName: String
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
  reactions: [IssueReaction!]!     # since 2026-05-18
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

type IssueEdge { node: Issue!, cursor: String! }
type IssueConnection {
  edges: [IssueEdge!]!
  nodes: [Issue!]!
  pageInfo: PageInfo!
  totalCount: Int!
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

type IssueLabelEdge { node: IssueLabel!, cursor: String! }
type IssueLabelConnection {
  edges: [IssueLabelEdge!]!
  nodes: [IssueLabel!]!
  pageInfo: PageInfo!
  totalCount: Int!
}

enum IssueRelationType { related, blocks, blocked_by, duplicate }

type IssueRelation {
  id: ID!
  issueId: ID!
  relatedIssueId: ID!
  type: IssueRelationType!
  issue: Issue!
  relatedIssue: Issue!
  createdAt: DateTime!
}

type IssueActivity {
  id: ID!
  issueId: ID!
  actorId: ID
  field: String!      # 'status', 'assignee', 'priority', 'labels', ...
  oldValue: String
  newValue: String
  actor: User
  createdAt: DateTime!
}

type IssueTemplate {
  id: ID!
  teamId: ID!
  creatorId: ID
  name: String!
  description: String
  templateData: JSON!      # prefilled issue payload
  isDefault: Boolean!
  team: Team!
  creator: User
  createdAt: DateTime!
  updatedAt: DateTime!
  archivedAt: DateTime
}
```

Issues carry **no** `url`, `priorityLabel`, `subIssueSortOrder`,
`snoozedUntilAt`, `previousIdentifiers`, or SLA fields in GraphQL today —
those live on the DB row but aren't exposed yet.

### 4.5 Project, ProjectMilestone, ProjectUpdate

```graphql
type Project {
  id: ID!
  name: String!
  slugId: String!
  description: String!
  content: String
  icon: String
  color: String!
  statusType: String!     # 'planned' | 'started' | 'paused' | 'completed' | 'canceled'
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
  progressHistory: [ProgressHistoryPoint!]!   # since 2026-05-18
}

# Per-day progress snapshot. Stamped once per UTC day on the first
# `progressHistory` read; intra-day reads return the cached value
# (see PATTERNS.md §44).
type ProgressHistoryPoint {
  date: String!                # YYYY-MM-DD
  completedIssueCount: Int!
  issueCount: Int!
  completedScope: Float!       # sum of estimate for completed issues
  scope: Float!                # sum of estimate for all in-scope issues
}

type ProjectEdge { node: Project!, cursor: String! }
type ProjectConnection {
  edges: [ProjectEdge!]!
  nodes: [Project!]!
  pageInfo: PageInfo!
  totalCount: Int!
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
```

### 4.6 Cycle

```graphql
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
  teamId: ID!
  organizationId: ID!
  team: Team!
  issues: [Issue!]!
  archivedAt: DateTime
  createdAt: DateTime!
  updatedAt: DateTime!
}

type CycleVelocityResult {
  averageIssues: Float!
  cycles: [CycleVelocityCycle!]!
}
type CycleVelocityCycle { cycleId: ID!, cycleNumber: Int!, completedIssues: Int! }
type CycleBurndownPoint { date: String!, remaining: Int!, completed: Int! }

type CycleRolloverPayload {
  success: Boolean!
  lastSyncId: String!
  movedCount: Int!
  nextCycleId: ID
}
```

### 4.7 Comment + CommentReaction

```graphql
type Comment {
  id: ID!
  issueId: ID!
  authorId: ID!
  body: String!         # plain / markdown text used by search
  bodyData: JSON        # TipTap JSON representation
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
```

### 4.8 CustomView, Document, File, Notification

```graphql
type CustomView {
  id: ID!
  organizationId: ID!
  teamId: ID                 # null = workspace-level
  creatorId: ID!
  name: String!
  description: String
  icon: String
  color: String
  filters: JSON!             # IssueFilter + column picker state
  sort: JSON!                # [{ field, direction }]
  groupBy: String
  layout: String!            # 'list' | 'board'
  shared: Boolean!
  sortOrder: Float!
  creator: User!
  team: Team
  createdAt: DateTime!
  updatedAt: DateTime!
  archivedAt: DateTime
}

type Document {
  id: ID!
  organizationId: ID!
  teamId: ID
  projectId: ID
  creatorId: ID
  parentId: ID               # self-referential hierarchy
  title: String!
  content: String            # markdown for search
  icon: String
  sortOrder: Float!
  createdAt: DateTime!
  updatedAt: DateTime!
  archivedAt: DateTime
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

type Notification {
  id: ID!
  organizationId: ID!
  userId: ID!
  issueId: ID
  actorId: ID
  type: String!              # ISSUE_ASSIGNED, ISSUE_MENTIONED, ISSUE_COMMENTED, ISSUE_STATUS_CHANGED, ...
  data: JSON!                # denormalized payload the UI renders directly
  read: Boolean!
  readAt: DateTime
  snoozedUntilAt: DateTime
  actor: User
  issue: Issue
  createdAt: DateTime!
  updatedAt: DateTime!
}
```

### 4.9 Public Roadmap

```graphql
type PublicRoadmap {
  id: ID!
  organizationId: ID!
  slug: String!
  enabled: Boolean!
  title: String!
  description: String
  hasPassword: Boolean!        # never exposes the hash itself
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
```

### 4.10 Custom Fields

```graphql
enum CustomFieldType { text, number, date, select, multi_select, url, checkbox }

type CustomFieldDefinition {
  id: ID!
  teamId: ID!
  name: String!
  type: CustomFieldType!
  description: String
  required: Boolean!
  options: JSON             # [{ value, label, color? }] for select/multi_select; null otherwise
  sortOrder: Float!
  createdAt: DateTime!
  updatedAt: DateTime!
  archivedAt: DateTime
  team: Team!
}

type CustomFieldValue {
  id: ID!
  issueId: ID!
  definitionId: ID!
  value: JSON!              # shape depends on type; see §4.11 of DATABASE_SCHEMA.md
  createdAt: DateTime!
  updatedAt: DateTime!
  definition: CustomFieldDefinition!
}
```

---

## 5. Queries

```graphql
type Query {
  # Current session
  viewer: User!
  organization: Organization!
  organizationMembers: [OrganizationMemberEntry!]!

  # Teams
  team(id: ID!): Team!
  teams: [Team!]!

  # Issues
  issue(id: ID!): Issue!
  issues(
    filter: IssueFilter
    first: Int
    after: String
    last: Int
    before: String
    includeArchived: Boolean
  ): IssueConnection!
  searchIssues(query: String!, first: Int, includeArchived: Boolean): IssueConnection!
  issueActivities(issueId: ID!, limit: Int): [IssueActivity!]!
  issueRelations(issueId: ID!): [IssueRelation!]!
  issueTemplates(teamId: String!, includeArchived: Boolean): [IssueTemplate!]!
  issueTemplate(id: ID!): IssueTemplate!
  issueFiles(issueId: ID!): [File!]!

  # Labels (cursor-paginated)
  labels(teamId: String): IssueLabelConnection!

  # Projects
  project(id: ID!): Project!
  projects(filter: ProjectFilter, first: Int, after: String, includeArchived: Boolean): ProjectConnection!

  # Cycles
  cycle(id: ID!): Cycle!
  cycles(teamId: String!, includeArchived: Boolean): [Cycle!]!
  cycleVelocity(teamId: ID!, cycleCount: Int): CycleVelocityResult!
  cycleBurndown(cycleId: ID!): [CycleBurndownPoint!]!

  # Views & documents
  customView(id: ID!): CustomView!
  customViews(teamId: String): [CustomView!]!
  documents(teamId: ID, projectId: ID): [Document!]!
  document(id: ID!): Document

  # Comments
  comments(issueId: ID!, includeArchived: Boolean): [Comment!]!
  comment(id: ID!): Comment!

  # Notifications
  notifications(limit: Int): [Notification!]!
  notificationUnreadCount: Int!
  notificationIsSubscribed(issueId: ID!): Boolean!

  # Custom fields
  customFieldDefinitions(teamId: String!, includeArchived: Boolean): [CustomFieldDefinition!]!
  customFieldDefinition(id: ID!): CustomFieldDefinition!
  customFieldValuesForIssue(issueId: ID!): [CustomFieldValue!]!

  # Public roadmap
  publicRoadmap: PublicRoadmap                              # authed; current org's config
  publicRoadmapPage(slug: String!, password: String): PublicRoadmapPage!  # unauthenticated
}
```

> Most list queries return plain `[T!]!` arrays — only `issues`, `searchIssues`,
> `labels`, and `projects` are paginated. Pools are small enough that the
> client keeps all cycles / documents / custom views / templates / comments in
> MobX stores.

---

## 6. Mutations

Grouped for readability; see `schema.ts` L1056 onward for the authoritative
source.

### Auth (§2)

```
emailLogin, emailVerify, googleAuthStart (Query), googleAuthExchange, tokenRefresh, logout
organizationCreate
```

### Teams

```
teamCreate, teamUpdate, teamDelete         # teamDelete requires TeamDeleteInput (MOVE|DELETE issues)
teamMembershipCreate, teamMembershipUpdate, teamMembershipDelete
workflowStateCreate, workflowStateUpdate, workflowStateArchive
```

### Issues

```
issueCreate, issueUpdate, issueArchive, issueUnarchive, issueDelete
issueLabelCreate, issueLabelUpdate, issueLabelArchive
issueRelationCreate, issueRelationDelete
issueTemplateCreate, issueTemplateUpdate, issueTemplateArchive, issueTemplateDelete
issueReactionAdd(issueId, emoji), issueReactionRemove(issueId, emoji)   # since 2026-05-18

# Triage queue actions (triage-enabled teams only)
issueTriageAccept(issueId, input: { stateId, assigneeId?, priority?, cycleId? })
issueTriageDecline(issueId)
issueTriageMarkDuplicate(issueId, canonicalIssueId)
issueTriageSnooze(issueId, until: DateTime)
```

### Projects / Cycles

```
projectCreate, projectUpdate, projectArchive, projectDelete
projectAddTeam, projectRemoveTeam, projectAddMember, projectRemoveMember
projectMilestoneCreate, projectMilestoneUpdate, projectMilestoneDelete
projectUpdateCreate, projectUpdateUpdate, projectUpdateDelete
projectSetRoadmapVisible        # toggles public roadmap exposure

cycleCreate, cycleUpdate, cycleArchive, cycleDelete
cycleAddIssue, cycleRemoveIssue, cycleRollover
```

### Views / Documents / Files

```
customViewCreate, customViewUpdate, customViewArchive, customViewDelete
documentCreate, documentUpdate, documentArchive, documentDelete
fileDelete                       # upload goes through REST POST /api/upload
```

### Comments / Reactions

```
commentCreate, commentUpdate, commentDelete
commentResolve, commentUnresolve
commentReactionAdd, commentReactionRemove
```

### Notifications

```
notificationMarkRead, notificationMarkAllRead
notificationSnooze(id, until)
notificationSubscribe(issueId), notificationUnsubscribe(issueId)
```

### Custom Fields

```
customFieldDefinitionCreate / Update / Archive / Delete
customFieldValuesSet(issueId, values: [CustomFieldValueInput!]!)   # upsert + delete absent values in one call
```

### Org admin

```
organizationMemberUpdateRole(userId, role)
publicRoadmapUpsert(input: PublicRoadmapUpsertInput!)   # manages current org's PublicRoadmap row
```

### Initiatives

Top-level strategic objects above projects (m:n with `Project`). Progress
rolls up from linked projects' `progress`. See PATTERNS §39.

```
initiativeCreate, initiativeUpdate, initiativeArchive, initiativeDelete
initiativeAddProject(initiativeId, projectId)
initiativeRemoveProject(initiativeId, projectId)

# Status reports posted against an initiative (since 2026-05-18).
# Mirrors ProjectUpdate semantics. Author-only edit/delete enforced
# in the resolver; soft-delete emits a 'D' SyncAction. See PATTERNS §43.
initiativeUpdateCreate(input: InitiativeUpdateCreateInput!)
initiativeUpdateUpdate(id, input: InitiativeUpdateEditInput!)
initiativeUpdateDelete(id)

# Queries
initiative(id), initiatives(includeArchived?)
```

```graphql
type InitiativeUpdate {
  id: ID!
  initiativeId: ID!
  body: String!
  bodyData: JSON!
  health: String!         # 'onTrack' | 'atRisk' | 'offTrack'
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

# `Initiative.updates: [InitiativeUpdate!]!` returns non-archived
# updates newest-first.
```

### Issue Reactions

Emoji reactions on issues (since 2026-05-18). Unique per
`(issueId, userId, emoji)`; add is idempotent via upsert. See PATTERNS §42.

```
issueReactionAdd(issueId, emoji)        # IssueReactionPayload
issueReactionRemove(issueId, emoji)     # DeletePayload
# Reactions are read inline via Issue.reactions: [IssueReaction!]!
```

### Webhooks (admin-only)

Outbound HTTP subscriptions; signed with HMAC-SHA256 (`X-Bilinear-Signature`).
Events fire from issue/comment/project/cycle/initiative resolvers. See
PATTERNS §40 and DATABASE_SCHEMA §2.21.

```
webhookCreate(input: { name, url, events, enabled?, teamId? })
webhookUpdate, webhookArchive, webhookDelete
webhookRotateSecret(id)

# Queries (org admins only)
webhook(id), webhooks(includeArchived?)
webhookDeliveries(webhookId, limit?)
webhookEvents       # canonical list of subscribable event names
```

`Webhook.signingSecret` is returned only to org owners/admins; the
field-level resolver returns `null` for other callers as defense-in-depth.

---

## 7. Key Input Types

### IssueCreateInput / IssueUpdateInput

```graphql
input IssueCreateInput {
  id: String                    # client-supplied UUID for offline-first
  title: String!
  description: String
  teamId: String!
  stateId: String               # optional; service falls back to team default
  assigneeId: String
  priority: Int
  estimate: Float
  dueDate: Date
  labelIds: [String!]
  parentId: String              # enables sub-issue inheritance of project/cycle
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
```

### IssueFilter (current minimal surface)

```graphql
input IssueFilter {
  teamId: String
  stateId: String
  assigneeId: String
  priority: Int
  trashed: Boolean
}
```

> The client-side `FilterComposition` structure (AND/OR trees, comparator
> operators, label / project / cycle predicates) lives in the `filters` JSONB
> of `CustomView` and is applied **client-side** in MobX. GraphQL does not
> accept those richer filters today.

### CustomViewCreateInput / UpdateInput

```graphql
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
```

### Comment / Document / Cycle inputs

```graphql
input CommentCreateInput {
  id: String
  issueId: String!
  body: String!
  bodyData: JSON
  parentId: String
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

input CycleCreateInput {
  id: String
  teamId: String!
  name: String
  description: String
  startsAt: DateTime!
  endsAt: DateTime!
}
```

### PublicRoadmapUpsertInput

```graphql
input PublicRoadmapUpsertInput {
  slug: String        # unique per org; changing it rekeys the public URL
  enabled: Boolean
  title: String
  description: String
  password: String    # plaintext; server hashes before storing. "" clears password.
}
```

### CustomFieldValueInput

```graphql
input CustomFieldValueInput {
  definitionId: String!
  value: JSON          # null clears the value (row is deleted)
}
```

---

## 8. Sync Endpoints (REST)

These are plain Next.js route handlers, not GraphQL.

### `GET /api/sync/bootstrap`

Returns every entity the current user can see in their org, plus the current
`lastSyncId`. Response shape:

```jsonc
{
  "lastSyncId": "1237",
  "users": [...],
  "organization": {...},
  "teams": [...],
  "workflowStates": [...],
  "issues": [...],
  "issueLabels": [...],
  "labelAssignments": [...],
  "projects": [...],
  "projectMilestones": [...],
  "projectUpdates": [...],
  "projectTeams": [...],
  "projectMembers": [...],
  "cycles": [...],
  "customViews": [...],
  "notifications": [...],
  "issueRelations": [...],
  "issueTemplates": [...],
  "customFieldDefinitions": [...],
  "customFieldValues": [...],
  "documents": [...],
  "publicRoadmap": null | {...},
  "comments": [...],
  "commentReactions": [...],
  "files": [...]
}
```

Clients populate IndexedDB (Dexie) from this payload, then hydrate MobX pools
from IndexedDB on subsequent boots to keep first paint fast.

### `GET /api/sync/delta?lastSyncId=<n>`

Returns all `SyncAction` rows with `id > n`, ordered ascending. Each entry is
`{ id, action: 'I'|'U'|'D'|'A', modelName, modelId, data }` with `data` being
the serialized entity for `I`/`U` and `null` for `D`. The client walks the
list, applies each action to the matching MobX pool, and persists the new
`lastSyncId`.

Delta sync is the recovery path for missed WebSocket pushes (tab-sleep,
offline, auth refresh).

---

## 9. WebSocket Protocol

```
ws://<host>:3001?token=<accessToken>
```

- Run separately from Next.js (`yarn ws:server` on port 3001 in dev).
- Token is validated on the query string; there is no `Authorization` header.
- Server pushes frames that mirror the `SyncAction` shape:

  ```jsonc
  {
    "type": "sync",
    "payload": {
      "id": "1245",
      "action": "U",
      "modelName": "Issue",
      "modelId": "...",
      "data": { /* serialized entity */ }
    }
  }
  ```

- The server subscribes to the org's Redis Pub/Sub channel (`org:{orgId}`) and
  fans out to every connected socket for that org.
- Clients ignore their own echoes by comparing the `X-Client-Id` header set on
  the GraphQL mutation to a field stamped into the action. Reconnects trigger
  a `GET /api/sync/delta` catch-up.

---

## 10. File Uploads

`POST /api/upload` (multipart/form-data, authed cookie). Body contains the
file plus `issueId` or `projectId`. Response is the resulting `File` row:

```jsonc
{ "file": { "id": "...", "name": "...", "key": "...", "url": "/api/uploads/<key>", ... } }
```

Storage backend is swappable: dev uses local disk (`data/uploads/`) served
through the `/api/uploads/[...path]` route; production is expected to swap in
S3-compatible storage via the `FileService`.

---

## 11. TipTap JSON in bodyData

`Comment.bodyData` and `ProjectUpdate.bodyData` carry the TipTap ProseMirror
document tree as `JSON`. The TipTap extension set is aligned between client
and server (see `src/lib/editor/` and `src/server/lib/tiptap-schema.ts`) so
the server can render to markdown for search indexing. `Document.content` is
stored as a single opaque string today — a structured JSON column existed
briefly but was unused and has been dropped (see DATABASE_SCHEMA §2.19).

---

## 12. Rate Limiting

Enforced as Next.js middleware, backed by Redis:

| Surface        | Budget                                 |
| -------------- | -------------------------------------- |
| `/api/graphql` | 5,000 req / hour / user                |
| `/api/auth/*`  | Stricter per-IP caps on login + verify |

Responses over the budget throw `GraphQLError` with `extensions.code =
RATELIMITED`. Cost-based complexity limits (operation-weighted points) are a
design target.

---

## 13. Conventions Summary

- **Every write returns `lastSyncId`.** Client feeds it back into delta sync
  for catch-up after reconnect.
- **Every write emits a SyncAction.** Services call
  `ctx.services.sync.createSyncAction(orgId, action, modelName, modelId, data)`
  inside the same Prisma transaction.
- **Services own the business logic, resolvers stay thin.** Resolver =
  `requireAuth(ctx)` → service call → remap service errors to `GraphQLError`.
- **Clients generate UUIDs.** `*CreateInput.id` is client-supplied to keep
  offline-first writes idempotent.
- **Servers trust snake_case in the DB, camelCase everywhere else.** Prisma
  `@map` bridges the two.

---

## 14. Planned / Not Yet in the Schema

The following types / operations appeared in earlier versions of this doc as
design targets; they are **not** in `schema.ts` today. When a sprint lands
one, delete its row here and add a §4 entry above.

| Surface                                                                       | Status | Notes                                                                          |
| ----------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------ |
| `Attachment`, `attachmentCreate/...`                                          | 📋      | Linked external resources (Figma, Google Doc). `File` covers raw uploads only. |
| `Favorite`, `favoriteCreate/...`                                              | 📋      | Sidebar pinning (Sprint 43-44).                                                |
| ~~`Initiative`, `initiativeCreate/...`~~                                      | ✅      | Shipped 2026-05-05; see §6.7 above. InitiativeUpdate timeline shipped 2026-05-18.|
| `Template` (polymorphic)                                                      | 📋      | Project / document templates. Issue-only today via `IssueTemplate`.            |
| `Webhook`, `webhookCreate/...`                                                | 📋      | Outbound HMAC-signed webhooks (Sprint 49-50).                                  |
| `apiKeyCreate / apiKeyDelete`                                                 | 📋      | Personal API keys.                                                             |
| `Reaction` on issues / project updates                                        | 📋      | Only comment reactions shipped.                                                |
| Rich `IssueFilter` comparators (AND/OR trees, string/number/date comparators) | 📋      | Client-side only today; server accepts the minimal filter above.               |
| `subscription` GraphQL operations                                             | 📋      | Real-time is over a dedicated WS side-channel.                                 |
| User-visible audit log (`auditEntries`)                                       | 📋      | Enterprise feature.                                                            |
| SAML / SCIM auth flows                                                        | 📋      | Enterprise tier.                                                               |
| SLA / snooze fields on `Issue`                                                | ⚠️      | DB columns exist; GraphQL exposure pending.                                    |

The REST sync endpoints, WebSocket protocol, and rate-limit surface may also
pick up enhancements (HTTP/2, operation cost limits, per-org WS quotas). These
are tracked in `IMPLEMENTATION_PLAN.md`.
