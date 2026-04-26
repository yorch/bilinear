# Sprint 3-4: Teams & Workflow States

## Issue Tracker — Linear Rebuild

**Phase:** 1 (Foundation)
**Weeks:** 3-4
**Goal:** Teams with customizable workflow states
**Status:** ✅ Shipped — historical spec; current state lives in `docs/IMPLEMENTATION_PLAN.md` and the source tree.

**Prerequisites:** Sprint 1-2 (auth, database, GraphQL server, app shell)

---

## 1. Overview

This sprint adds multi-team support with customizable workflow states. Teams are the primary organizational unit — issues belong to a team, and each team has its own set of workflow states organized into fixed categories. This sprint also establishes the pattern for all future CRUD entities.

---

## 2. Patterns to Establish

### 2.1 Entity CRUD Pattern

Every entity going forward follows this consistent structure. Teams are the first entity to establish it:

```text
src/server/
├── graphql/resolvers/team.ts       # Thin resolver: auth check → service call
├── services/team.service.ts        # Business logic + Prisma queries
└── graphql/types/team.ts           # GraphQL type definitions (if using code-first)
```

**Resolver pattern:**

```typescript
teamCreate: async (_parent, { input }, ctx) => {
  requireAuth(ctx);
  requireOrgRole(ctx, ['owner', 'admin']);
  const team = await ctx.services.team.create(ctx.orgId, input);
  // NOTE: lastSyncId is a placeholder (0) until Sprint 7-8 introduces the sync engine.
  // After Sprint 7-8, this becomes: ctx.services.sync.createSyncAction(...)
  return { success: true, team, lastSyncId: 0 };
},
```

**Service pattern:**

```typescript
async create(orgId: string, input: TeamCreateInput): Promise<Team> {
  return this.prisma.$transaction(async (tx) => {
    const team = await tx.team.create({ data: { ... } });
    // Seed default workflow states
    await this.seedDefaultStates(tx, team.id);
    return team;
  });
}
```

### 2.2 Seeding Pattern

When a team is created, seed these 5 default workflow states:

| Name        | Type      | Color     | Position |
| ----------- | --------- | --------- | -------- |
| Backlog     | backlog   | `#bec2c8` | 0        |
| Todo        | unstarted | `#e2e2e2` | 1        |
| In Progress | started   | `#f2c94c` | 2        |
| Done        | completed | `#5e6ad2` | 3        |
| Canceled    | canceled  | `#95a2b3` | 4        |

> **Triage state** is only seeded when `triageEnabled` is set to `true` on the team (added as position 0, shifting others). Triage is disabled by default. See Phase 3 Sprint 35-36 for the full triage workflow.

### 2.3 Authorization Pattern

Establish role-based checks as reusable helpers:

```typescript
// src/server/middleware/auth.ts — add these alongside existing JWT middleware
export function requireAuth(ctx: GraphQLContext): void { ... }
export function requireOrgRole(ctx: GraphQLContext, roles: string[]): void { ... }
export function requireTeamMember(ctx: GraphQLContext, teamId: string): void { ... }
export function requireTeamOwner(ctx: GraphQLContext, teamId: string): void { ... }
```

### 2.4 UI Component Pattern for Settings Pages

Establish the layout pattern for settings/configuration pages:

```text
src/app/(workspace)/[workspace]/settings/
├── layout.tsx                    # Settings layout with nav sidebar
└── teams/
    └── [teamKey]/
        ├── page.tsx              # Team general settings
        └── workflow/page.tsx     # Workflow state management
```

---

## 3. Database Schema (Prisma)

**Ref:** `docs/DATABASE_SCHEMA.md` sections 2.2 (Teams), 2.3 (Workflow States)

### Models to add to `prisma/schema.prisma`

```prisma
model Team {
  id              String    @id @default(uuid()) @db.Uuid
  organizationId  String    @map("organization_id") @db.Uuid
  name            String    @db.VarChar(255)
  key             String    @db.VarChar(10)
  displayName     String    @map("display_name") @db.VarChar(255)
  description     String?
  icon            String?   @db.VarChar(255)
  color           String?   @db.VarChar(7)
  private         Boolean   @default(false)

  // Hierarchy
  parentId        String?   @map("parent_id") @db.Uuid

  // Timezone
  timezone        String    @default("UTC") @db.VarChar(63)

  // Cycle configuration (used in Sprint 15-16)
  cyclesEnabled           Boolean @default(false) @map("cycles_enabled")
  cycleDuration           Int?    @default(2) @map("cycle_duration")
  cycleCooldownTime       Int?    @default(0) @map("cycle_cooldown_time")
  cycleStartDay           Int?    @default(1) @map("cycle_start_day")
  cycleLockToActive       Boolean @default(false) @map("cycle_lock_to_active")
  cycleAutoAssignStarted  Boolean @default(false) @map("cycle_auto_assign_started")
  cycleAutoAssignCompleted Boolean @default(false) @map("cycle_auto_assign_completed")

  // Auto-close/archive
  autoClosePeriod         Int?    @map("auto_close_period")
  autoCloseStateId        String? @map("auto_close_state_id") @db.Uuid
  autoArchivePeriod       Int?    @map("auto_archive_period")
  autoCloseChildIssues    Boolean @default(false) @map("auto_close_child_issues")
  autoCloseParentIssues   Boolean @default(false) @map("auto_close_parent_issues")

  // Estimation
  issueEstimationType     String  @default("notUsed") @map("issue_estimation_type") @db.VarChar(20)
  issueEstimationExtended Boolean @default(false) @map("issue_estimation_extended")
  issueEstimationAllowZero Boolean @default(false) @map("issue_estimation_allow_zero")
  defaultIssueEstimate    Float?  @map("default_issue_estimate")

  // Defaults
  defaultIssueStateId     String? @map("default_issue_state_id") @db.Uuid
  triageEnabled           Boolean @default(false) @map("triage_enabled")

  // Counter
  issueCount              Int     @default(0) @map("issue_count")

  // Lifecycle
  joinByDefault           Boolean @default(false) @map("join_by_default")
  retiredAt               DateTime? @map("retired_at") @db.Timestamptz
  createdAt               DateTime @default(now()) @map("created_at") @db.Timestamptz
  updatedAt               DateTime @updatedAt @map("updated_at") @db.Timestamptz
  archivedAt              DateTime? @map("archived_at") @db.Timestamptz

  organization            Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  parent                  Team?    @relation("TeamHierarchy", fields: [parentId], references: [id], onDelete: SetNull)
  children                Team[]   @relation("TeamHierarchy")
  memberships             TeamMembership[]
  workflowStates          WorkflowState[]

  @@unique([organizationId, key])
  @@index([organizationId])
  @@index([parentId])
  @@map("teams")
}

model TeamMembership {
  id        String   @id @default(uuid()) @db.Uuid
  teamId    String   @map("team_id") @db.Uuid
  userId    String   @map("user_id") @db.Uuid
  isOwner   Boolean  @default(false) @map("is_owner")
  sortOrder Float    @default(0) @map("sort_order")

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz

  team      Team     @relation(fields: [teamId], references: [id], onDelete: Cascade)
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([teamId, userId])
  @@index([teamId])
  @@index([userId])
  @@map("team_memberships")
}

model WorkflowState {
  id          String    @id @default(uuid()) @db.Uuid
  teamId      String    @map("team_id") @db.Uuid
  name        String    @db.VarChar(255)
  color       String    @db.VarChar(7)
  description String?
  type        String    @db.VarChar(20) // triage, backlog, unstarted, started, completed, canceled
  position    Float     @default(0)

  createdAt   DateTime  @default(now()) @map("created_at") @db.Timestamptz
  updatedAt   DateTime  @updatedAt @map("updated_at") @db.Timestamptz
  archivedAt  DateTime? @map("archived_at") @db.Timestamptz

  team        Team      @relation(fields: [teamId], references: [id], onDelete: Cascade)

  @@index([teamId])
  @@index([teamId, type])
  @@map("workflow_states")
}
```

Also add to existing `User` model:

```prisma
// Add to User model relations
teamMemberships TeamMembership[]
```

---

## 4. GraphQL API

**Ref:** `docs/API_DESIGN.md` sections 4.3 (Team), 4.5 (WorkflowState), 5 (Queries), 6 (Mutations)

### Queries

```graphql
type Query {
  team(id: ID!): Team!
  teams(first: Int, after: String): TeamConnection!
}
```

### Mutations

```graphql
type Mutation {
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

input TeamCreateInput {
  id: String
  name: String!
  key: String!
  description: String
  icon: String
  color: String
  private: Boolean
  timezone: String
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

type TeamPayload {
  success: Boolean!
  team: Team
  lastSyncId: String!  # BigInt serialized as string (see Sprint 7-8 sync engine notes)
}

type WorkflowStatePayload {
  success: Boolean!
  workflowState: WorkflowState
  lastSyncId: String!  # BigInt serialized as string (see Sprint 7-8 sync engine notes)
}
```

### Types

```graphql
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
  states(first: Int, after: String): WorkflowStateConnection!
  members(first: Int, after: String): UserConnection!
  memberships(first: Int, after: String): TeamMembershipConnection!
  createdAt: DateTime!
  updatedAt: DateTime!
  archivedAt: DateTime
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

type TeamMembership {
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

## 5. Business Logic

### Workflow State Constraints

- Each team must have **at least one state** of type `completed` and `canceled`
- State `type` must be one of: `triage`, `backlog`, `unstarted`, `started`, `completed`, `canceled`
- Cannot archive the last state of a required type (`completed`, `canceled`)
- Cannot change a state's `type` after creation (only name, color, position, description)

### Team Key Rules

- 1-10 uppercase characters
- Must be unique within the organization
- Cannot be changed after creation (used in issue identifiers like `ENG-123`)

---

## 6. Files to Create/Modify

| File                                                                | Action     | Purpose                                        |
| ------------------------------------------------------------------- | ---------- | ---------------------------------------------- |
| `prisma/schema.prisma`                                              | **Modify** | Add Team, TeamMembership, WorkflowState models |
| `src/server/graphql/resolvers/team.ts`                              | **Create** | Team CRUD resolvers                            |
| `src/server/graphql/resolvers/workflow-state.ts`                    | **Create** | Workflow state CRUD resolvers                  |
| `src/server/graphql/resolvers/team-membership.ts`                   | **Create** | Membership resolvers                           |
| `src/server/services/team.service.ts`                               | **Create** | Team business logic + default state seeding    |
| `src/server/services/workflow-state.service.ts`                     | **Create** | State CRUD with constraints                    |
| `src/components/layouts/sidebar.tsx`                                | **Modify** | Add team navigation list                       |
| `src/components/teams/team-create-modal.tsx`                        | **Create** | Team creation dialog                           |
| `src/components/teams/team-switcher.tsx`                            | **Create** | Team dropdown in sidebar                       |
| `src/components/teams/team-members-list.tsx`                        | **Create** | Member management UI                           |
| `src/components/teams/workflow-state-list.tsx`                      | **Create** | Drag-sortable state list                       |
| `src/app/(workspace)/[workspace]/settings/layout.tsx`               | **Create** | Settings layout                                |
| `src/app/(workspace)/[workspace]/settings/teams/[teamKey]/page.tsx` | **Create** | Team settings                                  |
| `src/app/(workspace)/[workspace]/team/[key]/layout.tsx`             | **Create** | Team layout                                    |
| `src/app/(workspace)/[workspace]/team/[key]/page.tsx`               | **Create** | Team issues (placeholder for Sprint 5-6)       |

---

## 7. Dependencies to Install

```bash
# No new backend dependencies expected

# Frontend (if not already present)
yarn add @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities  # Drag-and-drop for state reordering
```

---

## 8. Acceptance Criteria

- [x] `teamCreate` mutation creates a team with auto-seeded default workflow states (5 states; 6 if triageEnabled)
- [x] `teamCreate` validates key uniqueness and format (1-10 uppercase chars)
- [x] `teams` query returns teams for the organization (pagination deferred to Sprint 5-6 with issue list)
- [x] `team` query returns a single team with its states and members
- [x] `teamUpdate` mutation updates team settings
- [x] `teamDelete` mutation soft-deletes a team (requires owner/admin role)
- [x] `teamMembershipCreate` adds a user to a team
- [x] `workflowStateCreate` creates a new state with valid type
- [x] `workflowStateUpdate` changes name/color/position but not type
- [x] `workflowStateArchive` refuses to archive the last completed/canceled state
- [ ] Sidebar shows list of teams the user belongs to
- [ ] Clicking a team in sidebar navigates to team view
- [ ] Team creation modal validates key format and uniqueness
- [ ] Team settings page allows editing name, description, timezone, estimation config
- [ ] Workflow state management UI allows reordering (drag), renaming, color changes, adding, and archiving

---

## 9. Implementation Notes

### Backend (Complete)

Additional files created beyond the original plan:

| File                                    | Purpose                                                                 |
| --------------------------------------- | ----------------------------------------------------------------------- |
| `src/server/middleware/auth.ts`         | Extended with `requireOrgRole`, `requireTeamMember`, `requireTeamOwner` |
| `src/server/graphql/context.ts`         | Updated with `prisma`, `TeamService`, `WorkflowStateService`            |
| `src/server/graphql/schema.ts`          | Extended with Team, WorkflowState, TeamMembership types + mutations     |
| `src/server/graphql/resolvers/index.ts` | Updated to include new resolvers                                        |
| `vitest.config.ts`                      | Vitest test runner configuration                                        |
| `src/test/setup.ts`                     | Test environment setup                                                  |
| `src/test/prisma-mock.ts`               | Prisma client mock factory                                              |
| `src/test/context-mock.ts`              | GraphQL context mock factory                                            |
| `src/test/fixtures.ts`                  | Shared test data                                                        |
| `.github/workflows/ci.yml`              | Added test job                                                          |

### Dependencies Added

| Package               | Type | Purpose            |
| --------------------- | ---- | ------------------ |
| `vitest`              | dev  | Test runner        |
| `@vitest/coverage-v8` | dev  | Coverage reporting |

### Test Coverage (new code)

| File                        | Statement Coverage                                      |
| --------------------------- | ------------------------------------------------------- |
| `team.service.ts`           | 96%                                                     |
| `workflow-state.service.ts` | 96%                                                     |
| `auth.ts` (middleware)      | 50% (new guards fully covered; Sprint 1-2 code not yet) |

---

## 10. Cross-References

| Topic                 | Document                  | Section                 |
| --------------------- | ------------------------- | ----------------------- |
| Team table schema     | `docs/DATABASE_SCHEMA.md` | 2.2 Teams               |
| Workflow state schema | `docs/DATABASE_SCHEMA.md` | 2.3 Workflow States     |
| Team GraphQL type     | `docs/API_DESIGN.md`      | 4.3 Team                |
| WorkflowState type    | `docs/API_DESIGN.md`      | 4.5 WorkflowState       |
| Team mutations        | `docs/API_DESIGN.md`      | 6. Mutations            |
| Authorization model   | `docs/ARCHITECTURE.md`    | 6.2 Authorization Model |
| Component hierarchy   | `docs/ARCHITECTURE.md`    | 4.1 (Sidebar, TeamNav)  |
| Routing               | `docs/ARCHITECTURE.md`    | 4.3 Routing             |
