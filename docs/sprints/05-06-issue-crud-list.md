# Sprint 5-6: Issue CRUD & List View

## Bilinear — Linear Rebuild

**Phase:** 1 (Foundation)
**Weeks:** 5-6
**Goal:** Create, view, and edit issues in a list view
**Status:** ✅ Complete

**Prerequisites:** Sprint 3-4 (teams, workflow states)

---

## 1. Overview

Issues are the core entity of the application. This sprint implements full issue CRUD with the primary list view, establishing the patterns for property editing, virtualized rendering, keyboard shortcuts, and the detail panel that all future views build upon.

---

## 2. Patterns to Establish

### 2.1 List Rendering Pattern

Issues are rendered as a flat list within each state group using plain `Array.map`. Each `IssueRow` is a fixed-height (36px) div.

```typescript
// Pattern: grouped flat list — simple, correct, no scroll container mismatch
{groupIssues.map(issue => (
  <IssueRow key={issue.id} issue={issue} ... />
))}
```

> **Virtualization note:** TanStack Virtual (`@tanstack/react-virtual`) was originally planned for per-group virtualization but removed because the virtualizer requires its `getScrollElement` to point to the **scrolling** container, and per-group containers are `overflow:hidden`. A page-level virtualizer spanning all groups (flattening state headers + rows into a single indexed list) is the correct approach and is deferred to Sprint 7-8 along with the broader state management overhaul.

### 2.2 Inline Editing Pattern

Clicking a field in the list view opens a popover/dropdown for editing. Establish this for: status, assignee, priority, labels, due date.

```typescript
// Pattern: inline field editor
<PropertyPopover
  trigger={<StatusBadge state={issue.state} />}
  options={workflowStates}
  value={issue.stateId}
  onChange={(stateId) => updateIssue(issue.id, { stateId })}
/>
```

### 2.3 Detail Panel Pattern

Issue detail slides in from the right side, overlaying the list. URL updates to `/[workspace]/issue/[ID]` for deep linking.

### 2.4 Keyboard Shortcut Pattern

Global keyboard shortcuts are registered via a hook:

```typescript
// Pattern: keyboard shortcut registration
useHotkeys('c', () => openCreateIssueModal());
useHotkeys('j', () => selectNextIssue());
useHotkeys('k', () => selectPreviousIssue());
useHotkeys('enter', () => openSelectedIssue());
```

### 2.5 Grouping Pattern

List items are grouped by a configurable field (default: status). Groups are collapsible sections with a header showing the group name and count.

---

## 3. Database Schema (Prisma)

**Ref:** `docs/DATABASE_SCHEMA.md` sections 2.4 (Issues), 2.5 (Labels)

### Models to add to `prisma/schema.prisma`

```prisma
model Issue {
  id              String    @id @default(uuid()) @db.Uuid
  organizationId  String    @map("organization_id") @db.Uuid
  teamId          String    @map("team_id") @db.Uuid
  number          Int
  identifier      String    @db.VarChar(20) // ENG-123
  previousIdentifiers String[] @default([]) @map("previous_identifiers")

  // Content
  title           String    @db.VarChar(1000)
  description     String?
  descriptionState Bytes?   @map("description_state") // YJS state

  // Properties
  priority        Int       @default(0) @db.SmallInt // 0=None,1=Urgent,2=High,3=Medium,4=Low
  estimate        Float?
  dueDate         DateTime? @map("due_date") @db.Date
  sortOrder       Float     @default(0) @map("sort_order")
  prioritySortOrder Float   @default(0) @map("priority_sort_order")
  subIssueSortOrder Float?  @map("sub_issue_sort_order")

  // Relationships
  stateId         String    @map("state_id") @db.Uuid
  assigneeId      String?   @map("assignee_id") @db.Uuid
  creatorId       String?   @map("creator_id") @db.Uuid
  parentId        String?   @map("parent_id") @db.Uuid
  // NOTE: FK constraints for projectId and cycleId are deferred — added via migration
  // in Sprint 13-14 (Projects) and Sprint 15-16 (Cycles) when those tables are created.
  // For now these are nullable UUIDs without foreign key constraints.
  projectId       String?   @map("project_id") @db.Uuid
  cycleId         String?   @map("cycle_id") @db.Uuid

  // Git
  branchName      String?   @map("branch_name") @db.VarChar(500)

  // SLA (tracked from creation, fully used in Phase 5 Sprint 51-52)
  slaBreachesAt   DateTime? @map("sla_breaches_at") @db.Timestamptz
  slaHighRiskAt   DateTime? @map("sla_high_risk_at") @db.Timestamptz
  slaMediumRiskAt DateTime? @map("sla_medium_risk_at") @db.Timestamptz
  slaStartedAt    DateTime? @map("sla_started_at") @db.Timestamptz
  slaType         String?   @map("sla_type") @db.VarChar(50)

  // Lifecycle timestamps
  startedAt       DateTime? @map("started_at") @db.Timestamptz
  completedAt     DateTime? @map("completed_at") @db.Timestamptz
  canceledAt      DateTime? @map("canceled_at") @db.Timestamptz
  autoArchivedAt  DateTime? @map("auto_archived_at") @db.Timestamptz
  autoClosedAt    DateTime? @map("auto_closed_at") @db.Timestamptz
  startedTriageAt DateTime? @map("started_triage_at") @db.Timestamptz
  triagedAt       DateTime? @map("triaged_at") @db.Timestamptz
  addedToCycleAt  DateTime? @map("added_to_cycle_at") @db.Timestamptz
  addedToProjectAt DateTime? @map("added_to_project_at") @db.Timestamptz

  // Soft delete / snooze
  trashed         Boolean   @default(false)
  snoozedById     String?   @map("snoozed_by_id") @db.Uuid
  snoozedUntilAt  DateTime? @map("snoozed_until_at") @db.Timestamptz

  // Metadata
  reactionData    Json      @default("{}") @map("reaction_data")
  customerTicketCount Int   @default(0) @map("customer_ticket_count")

  createdAt       DateTime  @default(now()) @map("created_at") @db.Timestamptz
  updatedAt       DateTime  @updatedAt @map("updated_at") @db.Timestamptz
  archivedAt      DateTime? @map("archived_at") @db.Timestamptz

  // Relations
  organization    Organization @relation(fields: [organizationId], references: [id])
  team            Team       @relation(fields: [teamId], references: [id])
  state           WorkflowState @relation(fields: [stateId], references: [id])
  assignee        User?      @relation("AssignedIssues", fields: [assigneeId], references: [id])
  creator         User?      @relation("CreatedIssues", fields: [creatorId], references: [id])
  snoozedBy       User?      @relation("SnoozedIssues", fields: [snoozedById], references: [id])
  parent          Issue?     @relation("SubIssues", fields: [parentId], references: [id], onDelete: SetNull)
  children        Issue[]    @relation("SubIssues")
  labelAssignments IssueLabelAssignment[]

  @@unique([teamId, number])
  @@index([organizationId])
  @@index([teamId])
  @@index([stateId])
  @@index([assigneeId])
  @@index([projectId])
  @@index([cycleId])
  @@index([parentId])
  @@index([identifier])
  @@index([teamId, priority])
  @@index([teamId, createdAt])
  @@index([updatedAt])
  @@map("issues")
}

model IssueLabel {
  id              String    @id @default(uuid()) @db.Uuid
  organizationId  String    @map("organization_id") @db.Uuid
  teamId          String?   @map("team_id") @db.Uuid // null = workspace-global
  name            String    @db.VarChar(255)
  color           String    @db.VarChar(7)
  description     String?

  isGroup         Boolean   @default(false) @map("is_group")
  parentId        String?   @map("parent_id") @db.Uuid

  creatorId       String?   @map("creator_id") @db.Uuid
  lastAppliedAt   DateTime? @map("last_applied_at") @db.Timestamptz

  createdAt       DateTime  @default(now()) @map("created_at") @db.Timestamptz
  updatedAt       DateTime  @updatedAt @map("updated_at") @db.Timestamptz
  archivedAt      DateTime? @map("archived_at") @db.Timestamptz

  organization    Organization @relation(fields: [organizationId], references: [id])
  team            Team?      @relation(fields: [teamId], references: [id])
  parent          IssueLabel? @relation("LabelHierarchy", fields: [parentId], references: [id], onDelete: SetNull)
  children        IssueLabel[] @relation("LabelHierarchy")
  creator         User?      @relation(fields: [creatorId], references: [id])
  assignments     IssueLabelAssignment[]

  @@index([organizationId])
  @@index([teamId])
  @@index([parentId])
  @@map("issue_labels")
}

model IssueLabelAssignment {
  id        String   @id @default(uuid()) @db.Uuid
  issueId   String   @map("issue_id") @db.Uuid
  labelId   String   @map("label_id") @db.Uuid
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz

  issue     Issue    @relation(fields: [issueId], references: [id], onDelete: Cascade)
  label     IssueLabel @relation(fields: [labelId], references: [id], onDelete: Cascade)

  @@unique([issueId, labelId])
  @@index([issueId])
  @@index([labelId])
  @@map("issue_label_assignments")
}
```

Also add relations to existing models:

```prisma
// Add to Team model
issues Issue[]
labels IssueLabel[]

// Add to User model
assignedIssues Issue[] @relation("AssignedIssues")
createdIssues  Issue[] @relation("CreatedIssues")
snoozedIssues  Issue[] @relation("SnoozedIssues")

// Add to WorkflowState model
issues Issue[]

// Add to Organization model
issues Issue[]
labels IssueLabel[]
```

---

## 4. GraphQL API

**Ref:** `docs/API_DESIGN.md` sections 4.4 (Issue), 4 (IssueLabel), 5 (Queries), 6 (Mutations), 7 (Input Types), 8 (Filter System)

### Queries

```graphql
type Query {
  issue(id: ID!): Issue!
  issues(
    filter: IssueFilter
    first: Int
    after: String
    last: Int
    before: String
    orderBy: PaginationOrderBy
    includeArchived: Boolean
  ): IssueConnection!
  labels(filter: LabelFilter, first: Int, after: String): IssueLabelConnection!
}
```

### Mutations

```graphql
type Mutation {
  issueCreate(input: IssueCreateInput!): IssuePayload!
  issueUpdate(id: ID!, input: IssueUpdateInput!): IssuePayload!
  issueArchive(id: ID!): IssuePayload!
  issueUnarchive(id: ID!): IssuePayload!
  issueDelete(id: ID!): DeletePayload!

  issueLabelCreate(input: IssueLabelCreateInput!): IssueLabelPayload!
  issueLabelUpdate(id: ID!, input: IssueLabelUpdateInput!): IssueLabelPayload!
  issueLabelArchive(id: ID!): IssueLabelPayload!
}
```

### Input Types

```graphql
input IssueCreateInput {
  id: String              # Client-generated UUID (offline-first)
  title: String!
  description: String
  teamId: String!
  stateId: String
  assigneeId: String
  priority: Int
  estimate: Float
  dueDate: TimelessDate
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
  dueDate: TimelessDate
  labelIds: [String!]
  parentId: String
  sortOrder: Float
  prioritySortOrder: Float
  trashed: Boolean
}
```

### Filter Types

Implement the full `IssueFilter` from API_DESIGN.md section 8, including `StringComparator`, `NumberComparator`, `DateComparator`, and nested relationship filters.

---

## 5. Business Logic

### Issue Identifier Generation

When creating an issue, atomically increment `team.issueCount` and generate identifier:

```typescript
async create(orgId: string, input: IssueCreateInput): Promise<Issue> {
  return this.prisma.$transaction(async (tx) => {
    // Atomic increment
    const team = await tx.team.update({
      where: { id: input.teamId },
      data: { issueCount: { increment: 1 } },
    });
    const number = team.issueCount;
    const identifier = `${team.key}-${number}`;

    const issue = await tx.issue.create({
      data: {
        id: input.id ?? undefined, // client-generated UUID support
        organizationId: orgId,
        teamId: input.teamId,
        number,
        identifier,
        title: input.title,
        stateId: input.stateId ?? team.defaultIssueStateId,
        // ... other fields
      },
    });

    // Handle label assignments
    if (input.labelIds?.length) {
      await tx.issueLabelAssignment.createMany({ ... });
    }

    return issue;
  });
}
```

### Priority System

| Value | Label       | Icon  | Color     |
| ----- | ----------- | ----- | --------- |
| 0     | No priority | —     | `#8b8c91` |
| 1     | Urgent      | `!!!` | `#ef4444` |
| 2     | High        | `!!`  | `#f97316` |
| 3     | Medium      | `!`   | `#eab308` |
| 4     | Low         | `...` | `#6b7280` |

### Due Date Color Coding

- Past due: red
- Due today: orange
- Due within 3 days: yellow
- Otherwise: default

---

## 6. Frontend Components

### List View Component Tree

```text
TeamIssuesPage
├── FilterBar (placeholder — full implementation in Sprint 19-20)
│   └── SortSelect
├── IssueListView
│   ├── GroupSection (one per status group)
│   │   ├── GroupHeader (status name, count, collapse toggle)
│   │   └── VirtualizedIssueList
│   │       └── IssueRow (repeated)
│   │           ├── SelectCheckbox
│   │           ├── PriorityIcon
│   │           ├── IssueIdentifier (ENG-123)
│   │           ├── IssueTitle
│   │           ├── StatusBadge (clickable → popover)
│   │           ├── AssigneeAvatar (clickable → popover)
│   │           ├── LabelDots (clickable → popover)
│   │           ├── DueDateBadge (clickable → date picker)
│   │           └── EstimateBadge
├── IssueDetailPanel (slide-in from right)
│   ├── IssueHeader (identifier, title editable)
│   ├── IssueMetadata (status, assignee, priority, labels, etc.)
│   ├── DescriptionEditor (plain textarea for now — TipTap in Sprint 25-26)
│   └── ActivityFeed (placeholder)
└── CreateIssueModal
    ├── TitleInput
    ├── TeamSelect
    ├── StatusSelect
    ├── AssigneeSelect
    ├── PrioritySelect
    ├── LabelMultiSelect
    ├── DueDatePicker
    └── DescriptionTextarea
```

---

## 7. Files to Create/Modify

| File                                                  | Action     | Purpose                                       |
| ----------------------------------------------------- | ---------- | --------------------------------------------- |
| `prisma/schema.prisma`                                | **Modify** | Add Issue, IssueLabel, IssueLabelAssignment   |
| `src/server/graphql/resolvers/issue.ts`               | **Create** | Issue CRUD + query resolvers                  |
| `src/server/graphql/resolvers/label.ts`               | **Create** | Label CRUD resolvers                          |
| `src/server/services/issue.service.ts`                | **Create** | Issue logic (identifier gen, label sync)      |
| `src/server/services/label.service.ts`                | **Create** | Label CRUD                                    |
| `src/server/graphql/types/filters.ts`                 | **Create** | Filter input types (IssueFilter, comparators) |
| `src/app/(workspace)/[workspace]/team/[key]/page.tsx` | **Modify** | Wire up issue list view                       |
| `src/app/(workspace)/[workspace]/issue/[id]/page.tsx` | **Create** | Issue detail page                             |
| `src/components/issues/issue-list-view.tsx`           | **Create** | Virtualized grouped list                      |
| `src/components/issues/issue-row.tsx`                 | **Create** | Single issue row                              |
| `src/components/issues/issue-detail-panel.tsx`        | **Create** | Right-panel detail view                       |
| `src/components/issues/create-issue-modal.tsx`        | **Create** | Issue creation dialog                         |
| `src/components/issues/group-section.tsx`             | **Create** | Collapsible group header                      |
| `src/components/properties/status-select.tsx`         | **Create** | Status popover selector                       |
| `src/components/properties/priority-select.tsx`       | **Create** | Priority popover selector                     |
| `src/components/properties/assignee-select.tsx`       | **Create** | Assignee popover selector                     |
| `src/components/properties/label-select.tsx`          | **Create** | Multi-label popover selector                  |
| `src/components/properties/due-date-picker.tsx`       | **Create** | Date picker with color coding                 |
| `src/components/properties/priority-icon.tsx`         | **Create** | Priority level icon                           |
| `src/hooks/use-hotkeys.ts`                            | **Create** | Keyboard shortcut registration                |

---

## 8. Dependencies to Install

```bash
yarn add @tanstack/react-virtual   # List virtualization
yarn add date-fns                  # Date utilities
```

---

## 9. Acceptance Criteria

- [ ] `issueCreate` mutation creates an issue with auto-generated identifier (e.g., `ENG-1`)
- [ ] Sequential issue numbers are atomic (no duplicates under concurrent creation)
- [ ] `issueCreate` with client-generated UUID (`id` field) uses that UUID
- [ ] `issues` query with `filter` returns correctly filtered results
- [ ] `issues` query with Relay cursor pagination works (first/after, last/before)
- [ ] `issueUpdate` mutation updates individual fields
- [ ] `issueArchive` sets `archivedAt`, `issueUnarchive` clears it
- [ ] Label CRUD works; labels can be workspace-scoped (no teamId) or team-scoped
- [ ] List view renders with grouped-by-status layout
- [ ] Scrolling 1000+ issues is smooth (60fps via virtualization)
- [ ] Clicking a status badge opens a popover to change status
- [ ] Clicking an assignee avatar opens a popover to reassign
- [ ] Clicking priority icon opens a popover to change priority
- [ ] `C` shortcut opens create issue modal
- [ ] `J`/`K` navigate between issues in the list
- [ ] `Enter` opens the selected issue's detail panel
- [ ] Issue detail panel shows all metadata and allows editing
- [ ] Create issue modal allows setting title, team, status, assignee, priority, labels, due date

---

## 10. Cross-References

| Topic                   | Document                  | Section                  |
| ----------------------- | ------------------------- | ------------------------ |
| Issues table schema     | `docs/DATABASE_SCHEMA.md` | 2.4 Issues               |
| Labels table schema     | `docs/DATABASE_SCHEMA.md` | 2.5 Labels               |
| Issue GraphQL type      | `docs/API_DESIGN.md`      | 4.4 Issue                |
| IssueLabel GraphQL type | `docs/API_DESIGN.md`      | 4.7 (IssueLabel)         |
| Issue mutations         | `docs/API_DESIGN.md`      | 6. Mutations             |
| Issue input types       | `docs/API_DESIGN.md`      | 7. Input Types           |
| Filter system           | `docs/API_DESIGN.md`      | 8. Filter System         |
| Mutation payloads       | `docs/API_DESIGN.md`      | 9. Mutation Payloads     |
| Component hierarchy     | `docs/ARCHITECTURE.md`    | 4.1 (ListView, IssueRow) |
| State management        | `docs/ARCHITECTURE.md`    | 4.2 (IssueStore)         |
| Routing                 | `docs/ARCHITECTURE.md`    | 4.3 Routing              |
| Priority system         | `docs/PRD.md`             | Priority (5 levels)      |
