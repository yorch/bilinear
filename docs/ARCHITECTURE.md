# Architecture Design Document

## Issue Tracker — Linear Rebuild

**Version:** 1.4
**Date:** 2026-04-17

> **Implementation Status (as of Sprint 35-36 + public roadmap)**
>
> This document describes the **target architecture** for the full system. The table below tracks what is actually built:
>
> | Component | Status | Notes |
> |-----------|--------|-------|
> | Next.js 16 App Router + TypeScript | ✅ Built | Sprint 1-2 |
> | GraphQL API (Apollo Server, server-only) | ✅ Built | Sprint 1-2; frontend uses raw `fetch`, NO Apollo Client |
> | Prisma 7 + PostgreSQL | ✅ Built | Sprint 1-2 |
> | Auth — magic link email + JWT + Google OAuth | ✅ Built | Sprint 1-2 |
> | Teams, TeamMembership, WorkflowState | ✅ Built | Sprint 3-4 |
> | Issues, IssueLabels, property selectors, list/detail/create UI | ✅ Built | Sprint 5-6 |
> | TailwindCSS v4 + shadcn/ui | ✅ Built | Sprint 1-2 |
> | SyncAction table + generation on every mutation | ✅ Built | Sprint 7-8 |
> | REST sync endpoints (`/api/sync/bootstrap`, `/api/sync/delta`) | ✅ Built | Sprint 7-8 |
> | Standalone WebSocket server (`yarn ws:server`, port 3001) | ✅ Built | Sprint 7-8 |
> | Redis pub/sub for real-time broadcast | ✅ Built | Sprint 7-8 |
> | MobX stores — core (IssueStore, TeamStore, UserStore, LabelStore, WorkflowStateStore, SyncStore, UIStore) | ✅ Built | Sprint 7-8 |
> | MobX stores — extended (CycleStore, ProjectStore, CustomViewStore, NotificationStore, IssueRelationStore, IssueTemplateStore, CustomFieldStore, DocumentStore) | ✅ Built | Sprints 13-36 — see `src/stores/` |
> | IndexedDB cache via Dexie.js | ✅ Built | Sprint 7-8 |
> | SyncManager (bootstrap → IndexedDB → MobX → WebSocket delta catch-up) | ✅ Built | Sprint 7-8 |
> | TransactionQueue (serial mutation queue with retry/rollback) | ✅ Built | Sprint 7-8 |
> | PostgreSQL full-text search (GIN index, `searchIssues` resolver) | ✅ Built | Sprint 9-10 |
> | Fuzzy search + `IssueStore.search()` over titles + identifiers | ✅ Built | Sprint 9-10 |
> | Command palette (`Cmd+K`) with recent items, fuzzy search, action commands, sub-menus | ✅ Built | Sprint 9-10 |
> | `IssueContextMenu`, global keyboard shortcuts, `useChord`, `useRecentItems` | ✅ Built | Sprint 9-10 |
> | Dark mode (next-themes), skeleton loading, error boundaries, toast notifications (sonner via `@/lib/toast`), collapsible sidebar | ✅ Built | Sprint 11-12 |
> | Code splitting — lazy `CommandPalette` + `IssueDetailPanel` via `React.lazy` | ✅ Built | Sprint 11-12 |
> | API rate limiting — Redis fixed-window per user | ✅ Built | Sprint 11-12 |
> | Structured logging — pino + pino-pretty (`src/server/lib/logger.ts`) | ✅ Built | Sprint 11-12 |
> | E2E tests — Playwright (`tests/e2e/`, `yarn test:e2e`) | ✅ Built | Sprint 11-12 |
> | Projects (cross-team, milestones, updates, progress) | ✅ Built | Sprint 13-14 |
> | Cycles (cycle CRUD, list/detail views, `Q` shortcut) | ✅ Built | Sprint 15-16 |
> | Board view with drag-and-drop via @dnd-kit, swimlane grouping, within-column reordering | ✅ Built | Sprint 17-18, 31-32 |
> | Filter builder, custom views, backlog page, column picker, CSV export | ✅ Built | Sprint 19-20, 23-24 |
> | Notifications + inbox + issue activity timeline + notification snooze | ✅ Built | Sprint 21-22 |
> | Sub-issues (`Issue.parentId`), issue relations, issue templates, parent/child auto-close cascade, project/cycle inheritance from parent | ✅ Built | Sprint 25-26 |
> | TipTap rich text editor: markdown, @mentions, image upload persisted to `File` model, tables, code highlighting, embeds (YouTube/Loom) | ✅ Built | Sprint 27-28 (PR #27) |
> | TipTap — slash commands, Mermaid, YJS collaborative editing | 🔲 Planned | Not started |
> | Threaded comments with reactions and resolution (`Comment`, `CommentReaction`) | ✅ Built | Sprint 29-30 |
> | Sub-team hierarchy (`Team.parentId`), private teams, team roles (`TeamMemberRole`) | 🟡 Partial | Sprint 31-32 — no config inheritance or cross-team visibility yet |
> | Team analytics — burndown charts (hand-rolled SVG), cycle velocity | ✅ Built | Sprint 33-34 |
> | Sentry error tracking (`@sentry/nextjs`, `sentry.{client,edge,server}.config.ts`) | ✅ Built | Sprint 33-34 |
> | Cycle rollover (manual-trigger mutation), cycle burndown/velocity | ✅ Built | Sprint 33-34 |
> | Custom fields (team-scoped, editable in detail panel, filterable, list view) | ✅ Built | Sprint 23-24 |
> | Workspace admin settings page | ✅ Built | Sprint 31-32 |
> | Documents (workspace-wide rich-text docs with nested hierarchy, no YJS) | ✅ Built | Sprint 35-36 (PR #28) |
> | Public Roadmap (`/r/:slug`, password-gated option, per-project `roadmapVisible` toggle) | ✅ Built | Sprint 53-54 (PR #28) |
> | File uploads — `POST /api/upload` → `File` row + `/api/uploads/[...path]` serving; local disk in dev, S3-swappable | ✅ Built | Sprint 27-28 |
> | BullMQ background queues | 🔲 Planned | Sprint 37+ |
> | SAML / SCIM / API keys / webhooks | 🔲 Planned | Sprint 49-50 onward |
>
> Everything below describes the **intended final architecture**. Sections referencing unbuilt components (SAML, webhooks, BullMQ queues, MeiliSearch, YJS) are design specs, not current reality.

---

## 1. System Architecture Overview

```text
┌─────────────────────────────────────────────────────────────────┐
│                        CLIENT LAYER                              │
│                                                                  │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────┐   │
│  │  Web App  │  │ Desktop  │  │  Mobile  │  │ CLI / SDK    │   │
│  │ (React)  │  │(Electron)│  │  (RN)    │  │ (TypeScript) │   │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └──────┬───────┘   │
│       │              │              │               │            │
│  ┌────┴──────────────┴──────────────┴───────────────┴────────┐  │
│  │                    SYNC ENGINE                             │  │
│  │  ┌─────────┐  ┌──────────┐  ┌───────────┐  ┌──────────┐ │  │
│  │  │ MobX    │  │ IndexedDB│  │ WebSocket │  │ Optimistic│ │  │
│  │  │ Store   │  │ Cache    │  │ Client    │  │ Updates   │ │  │
│  │  └─────────┘  └──────────┘  └───────────┘  └──────────┘ │  │
│  └──────────────────────┬────────────────────────────────────┘  │
└─────────────────────────┼───────────────────────────────────────┘
                          │ GraphQL + WebSocket
                          │
┌─────────────────────────┼───────────────────────────────────────┐
│                   API GATEWAY LAYER                              │
│                         │                                        │
│  ┌──────────────────────┴────────────────────────────────────┐  │
│  │                  GraphQL API Server                        │  │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐ │  │
│  │  │ Auth     │  │ Rate     │  │ Query    │  │ Mutation  │ │  │
│  │  │ Layer    │  │ Limiter  │  │ Resolver │  │ Resolver  │ │  │
│  │  └──────────┘  └──────────┘  └──────────┘  └──────────┘ │  │
│  └──────────────────────┬────────────────────────────────────┘  │
│                         │                                        │
│  ┌──────────────────────┴────────────────────────────────────┐  │
│  │                  WebSocket Server                          │  │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐               │  │
│  │  │ Conn     │  │ Sync     │  │ Broadcast│               │  │
│  │  │ Manager  │  │ Engine   │  │ Engine   │               │  │
│  │  └──────────┘  └──────────┘  └──────────┘               │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────┼───────────────────────────────────────┘
                          │
┌─────────────────────────┼───────────────────────────────────────┐
│                   SERVICE LAYER                                  │
│                         │                                        │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐       │
│  │ Issue    │  │ Project  │  │ Auth     │  │ Notif    │       │
│  │ Service  │  │ Service  │  │ Service  │  │ Service  │       │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘       │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐       │
│  │ Sync     │  │ Webhook  │  │ Search   │  │ Integr.  │       │
│  │ Service  │  │ Service  │  │ Service  │  │ Service  │       │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘       │
└─────────────────────────┼───────────────────────────────────────┘
                          │
┌─────────────────────────┼───────────────────────────────────────┐
│                   DATA LAYER                                     │
│                         │                                        │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐       │
│  │PostgreSQL│  │  Redis   │  │ S3/Blob  │  │ Search   │       │
│  │ (Primary)│  │(Pub/Sub) │  │ (Files)  │  │ (Meili)  │       │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘       │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. Technology Stack

### 2.1 Frontend

| Layer          | Technology                   | Rationale                                               |
| -------------- | ---------------------------- | ------------------------------------------------------- |
| Framework      | **Next.js 16 (App Router)**  | SSR, routing, API routes, existing in repo              |
| Language       | **TypeScript**               | Type safety, shared types with backend                  |
| State          | **MobX**                     | Observable-based reactivity (matches Linear's approach) |
| Local DB       | **IndexedDB** (via Dexie.js) | Offline-first local cache                               |
| Real-time      | **WebSocket** (native)       | Delta sync, low latency                                 |
| Styling        | **Tailwind CSS + shadcn/ui** | Rapid UI development (already in repo)                  |
| Editor         | **TipTap** (ProseMirror)     | Rich text with collaborative editing                    |
| Virtualization | **TanStack Virtual**         | 60fps scrolling for large lists                         |
| DnD            | **@dnd-kit**                 | Accessible drag-and-drop                                |
| Date           | **date-fns**                 | Lightweight date utilities                              |
| Charts         | **Hand-rolled SVG** (`BurndownChart`, stat cards + CSS bars) | Single-purpose charts; no Recharts dependency |

### 2.2 Backend

| Layer        | Technology                                          | Rationale                                                                                                                  |
| ------------ | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Runtime      | **Node.js**                                         | TypeScript everywhere, shared types                                                                                        |
| API          | **GraphQL** (Apollo Server + @as-integrations/next) | Matches Linear's approach, flexible queries                                                                                |
| ORM          | **Prisma 7** + `@prisma/adapter-pg`                 | Type-safe, Rust-free; Prisma 7 requires a driver adapter — datasource URL lives in `prisma.config.ts`, not `schema.prisma` |
| Database     | **PostgreSQL 18**                                   | Relational, JSONB, full-text search, new I/O subsystem (up to 3× perf), uuidv7()                                           |
| Cache/PubSub | **Redis 7**                                         | Pub/sub for sync broadcast, session cache, rate limiting                                                                   |
| Search       | **MeiliSearch** or **PostgreSQL FTS**               | Full-text search with fuzzy matching                                                                                       |
| File Storage | **S3-compatible** (AWS S3 / Cloudflare R2)          | Attachment storage                                                                                                         |
| Auth         | **Custom JWT + OAuth2**                             | Magic links, Google OAuth, SAML                                                                                            |
| Queue        | **BullMQ** (Redis-backed)                           | Background jobs: webhooks, emails, imports                                                                                 |
| WebSocket    | **ws** library                                      | Raw WebSocket for sync engine                                                                                              |

### 2.3 Infrastructure

| Layer      | Technology                                             | Status | Rationale                     |
| ---------- | ------------------------------------------------------ | ------ | ----------------------------- |
| Hosting    | **Vercel** (frontend) + **Docker Compose** self-hosting | ✅ | `deployment/` has the full-stack compose file; Vercel deploy wired |
| CI/CD      | **GitHub Actions**                                     | ✅ | Unit + E2E + lint + typecheck + build on push |
| Errors     | **Sentry** (`@sentry/nextjs`)                          | ✅ | `sentry.{client,edge,server}.config.ts` |
| Metrics    | **Prometheus / Grafana**                               | 🔲 Planned | Not wired yet |
| CDN        | **Cloudflare**                                         | 🔲 Planned | Cloudflare-in-front is optional; Vercel edge covers the baseline |

---

## 3. Sync Engine Architecture

The sync engine is the most critical technical component. It enables the <50ms interaction times that define the product.

### 3.1 Design Principles

1. **Local-first:** All reads come from local IndexedDB; UI never waits for network
2. **Optimistic writes:** Mutations applied locally immediately, synced async
3. **Server-authoritative:** Server is source of truth; conflicts resolved by last-writer-wins
4. **Delta sync:** After initial bootstrap, only changes are transmitted

### 3.2 Data Flow

```text
USER ACTION
    │
    ▼
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│ MobX Store  │────▶│ Transaction  │────▶│  IndexedDB   │
│ (UI update) │     │ Queue        │     │ (persist)    │
└─────────────┘     └──────┬───────┘     └─────────────┘
                           │
                           ▼
                    ┌──────────────┐
                    │ GraphQL      │
                    │ Mutation     │
                    └──────┬───────┘
                           │
                           ▼
                    ┌──────────────┐
                    │ Server       │
                    │ (validates,  │
                    │  persists,   │
                    │  returns     │
                    │  lastSyncId) │
                    └──────┬───────┘
                           │
                           ▼
                    ┌──────────────┐
                    │ Redis PubSub │
                    │ (broadcast   │
                    │  SyncAction) │
                    └──────┬───────┘
                           │
                    ┌──────┴───────┐
                    ▼              ▼
             ┌──────────┐  ┌──────────┐
             │ Client A │  │ Client B │
             │ (via WS) │  │ (via WS) │
             └──────────┘  └──────────┘
```

### 3.3 SyncAction Schema

```typescript
interface SyncAction {
  id: bigint;          // Monotonically increasing BIGSERIAL (server-assigned)
                       // Serialized as String in GraphQL payloads and WebSocket
                       // messages to avoid 32-bit Int overflow on long-lived systems
  organizationId: string;
  action: 'I' | 'U' | 'D' | 'A';  // Insert, Update, Delete, Archive
  modelName: string;   // Entity type (e.g., "Issue", "Team", "WorkflowState")
  modelId: string;     // UUID of affected entity
  data: object | null; // Full entity snapshot (null for deletes)
  createdAt: string;   // ISO 8601
}
```

### 3.4 Bootstrap Process

```text
Phase 1 (Full Bootstrap):
  GET /api/sync/bootstrap
  → Returns all "instant-load" models (active/non-archived only):
    Organization, Team, User, OrganizationMember, TeamMembership,
    WorkflowState, IssueLabel, IssueLabelAssignment, Issue,
    Project, ProjectMilestone, ProjectUpdate, ProjectTeam, ProjectMember,
    Cycle, CustomView, IssueRelation, IssueTemplate,
    CustomFieldDefinition, CustomFieldValue,
    Document, PublicRoadmap (single row), Notification (user-scoped),
    Comment, CommentReaction, File
  → Response is a JSON object with one key per model plus `lastSyncId: string`
  → Written atomically to IndexedDB via Dexie transaction before MobX population

Deferred (loaded on demand via GraphQL):
  IssueActivity (fetched per-issue when detail panel opens)
  File content (streamed through /api/uploads/[...path])
  Search results (searchIssues query)

Phase 2 (Real-time):
  WebSocket connection to ws://host:3001?token=<jwt>
  → Server pushes: {cmd: "sync", sync: [SyncAction]}
  → {cmd: "ping"} → client replies {cmd: "pong"}
  → {cmd: "connected", orgId: "..."}

Reconnection (Delta Sync):
  GET /api/sync/delta?lastSyncId=X
  → Returns SyncActions with id > X for the authenticated org
  → Client applies deltas; updates lastSyncId in IndexedDB
  → Falls back to full bootstrap if delta returns non-200
```

**Implementation details (Sprint 7-8, extended through Sprint 35-36):**

- Bootstrap is fetched server-side with a single DB round-trip (parallel Prisma queries, one per model, all awaited together) plus `lastSyncId`
- `IssueLabelAssignment` join rows are sent alongside `IssueLabel` so the client rebuilds `Issue.labelIds` during hydration
- WebSocket auth uses a JWT passed as a `?token=` query param (browsers cannot set custom WS headers)
- The WS token is retrieved from `GET /api/auth/session` which reads the httpOnly cookie server-side
- `SyncManager` guards against concurrent `fullBootstrap` and `deltaSync` calls via boolean flags
- Sprint 36 expanded the bootstrap payload to include Documents, PublicRoadmap, and Comments; the `?type=partial` endpoint remains a design target that would split boot-critical from detail-only entities

### 3.5 Model Load Strategies

| Strategy  | When Loaded                                       | Examples                                                                 |
| --------- | ------------------------------------------------- | ------------------------------------------------------------------------ |
| `instant` | Full bootstrap                                    | Organization, Team, User, WorkflowState, IssueLabel, Issue, Project, Cycle, CustomView, Document, CustomField*, Notification, Comment, File |
| `lazy`    | On demand (per request)                           | IssueActivity (per issue), file bytes (per key), search results          |
| `local`   | Client-only                                       | UI state, sidebar collapse, column picker choices, drafts                |

### 3.6 Conflict Resolution

- **Last-writer-wins** for scalar fields
- **Server-authoritative:** server may produce side effects (e.g., auto-close parent when last child closes)
- **Transaction queue:** Failed transactions retry; permanently failed transactions roll back local state
- **Grace period:** Changes within 3 minutes of creation grouped as "creation activity"

---

## 4. Frontend Architecture

### 4.1 Component Hierarchy

```
App
├── AuthProvider
│   └── SyncProvider
│       └── WorkspaceProvider
│           ├── Sidebar
│           │   ├── WorkspaceSwitcher
│           │   ├── MyIssues
│           │   ├── Inbox                    ← notifications
│           │   ├── Documents                ← workspace docs tree
│           │   ├── Favorites                 🔲 Planned
│           │   └── TeamNav (per team)
│           │       ├── Issues
│           │       ├── Cycles
│           │       ├── Projects
│           │       └── Views
│           ├── MainContent
│           │   ├── ListView
│           │   │   ├── FilterBar (w/ column picker, CSV export)
│           │   │   ├── GroupHeader (incl. swimlanes)
│           │   │   └── IssueRow (virtualized)
│           │   ├── BoardView
│           │   │   ├── BoardColumn (swimlane-aware, reorderable)
│           │   │   └── IssueCard (draggable)
│           │   ├── BacklogView
│           │   ├── RoadmapPage (authed)
│           │   └── DocumentEditor (TipTap)
│           ├── DetailPanel
│           │   ├── IssueMetadata (incl. custom field values)
│           │   ├── DescriptionEditor (TipTap w/ @mentions, image upload, embeds)
│           │   ├── SubIssueList
│           │   ├── RelationsList
│           │   └── ActivityFeed
│           │       ├── Comment (threaded, resolvable, reactions)
│           │       └── IssueActivity entry
│           ├── CommandPalette (Cmd+K, lazy)
│           ├── CreateIssueModal (Alt+C for template picker)
│           └── NotificationToasts

# Unauthenticated tree
PublicRoadmapPage (/r/:slug)
└── RoadmapProjects
```

### 4.2 State Management (MobX)

```typescript
// Live shape in src/stores/root-store.ts
class RootStore {
  syncStore: SyncStore;                // bootstrap / delta / WS plumbing
  uiStore: UIStore;                    // sidebar, selection, active view

  userStore: UserStore;
  teamStore: TeamStore;
  workflowStateStore: WorkflowStateStore;
  labelStore: LabelStore;

  issueStore: IssueStore;              // primary entity pool
  issueRelationStore: IssueRelationStore;
  issueTemplateStore: IssueTemplateStore;

  projectStore: ProjectStore;
  cycleStore: CycleStore;
  customViewStore: CustomViewStore;
  notificationStore: NotificationStore;

  customFieldStore: CustomFieldStore;  // definitions + values (Sprint 23-24)
  documentStore: DocumentStore;        // Sprint 35-36
}

// Each entity store follows a common pattern:
class IssueStore {
  pool: Map<string, Issue>;            // observable Map<UUID, Issue>

  // MobX computed getters with filters
  get activeIssues(): Issue[];
  byTeam(teamId: string): Issue[];
  byProject(projectId: string): Issue[];

  // Sync integration
  applySyncAction(action: SyncAction): void;
  save(issue: Issue): Promise<void>;   // optimistic write + TransactionQueue enqueue
}
```

Stores not yet extracted (held on the RootStore directly or fetched
ad-hoc): `AuthStore` (auth state lives in the session cookie + `/api/auth/session`
fetch), `FileStore` (file rows come with the owning issue/project),
`CommentStore` (comments are hung off `IssueStore` by issueId), `PublicRoadmapStore`
(single row; lives on the workspace config path).

### 4.3 Routing

Actual app routes under `src/app/`:

```
/                              → login / redirect
/login                         → magic-link entry
/workspace/new                 → first-time org setup

/[workspace]                   → workspace home
/[workspace]/inbox             → notification inbox
/[workspace]/my-issues         → assigned-to-me
/[workspace]/backlog           → cross-team backlog
/[workspace]/documents         → org-wide documents tree
/[workspace]/roadmap           → public roadmap preview (authed)

/[workspace]/team/[key]           → team issues (default view)
/[workspace]/team/[key]/active    → active issues
/[workspace]/team/[key]/backlog   → team backlog
/[workspace]/team/[key]/triage    → triage inbox
/[workspace]/team/[key]/cycles    → cycles list
/[workspace]/team/[key]/projects  → projects list
/[workspace]/team/[key]/views     → custom views

/[workspace]/issue/[ID]           → issue detail (e.g., ENG-123)
/[workspace]/project/[slug]       → project detail
/[workspace]/cycle/[id]           → cycle detail
/[workspace]/view/[id]            → custom view
/[workspace]/document/[id]        → document detail

/[workspace]/settings                         → workspace settings
/[workspace]/settings/teams/[key]             → team settings (incl. custom fields)
/[workspace]/settings/roadmap                 → public roadmap config

# Unauthenticated
/r/[slug]                        → public roadmap (password-gated option)
```

---

## 5. Backend Architecture

### 5.1 GraphQL Schema Design

The live schema lives in `src/server/graphql/schema.ts`. Abbreviated excerpt:

```graphql
type Query {
  viewer: User!
  organization: Organization!
  organizationMembers: [OrganizationMemberEntry!]!

  team(id: ID!): Team!
  teams: [Team!]!

  issue(id: ID!): Issue!
  issues(filter: IssueFilter, first: Int, after: String, last: Int, before: String, includeArchived: Boolean): IssueConnection!
  searchIssues(query: String!, first: Int, includeArchived: Boolean): IssueConnection!

  labels(teamId: String): IssueLabelConnection!
  cycle(id: ID!): Cycle!
  cycles(teamId: String!, includeArchived: Boolean): [Cycle!]!
  cycleBurndown(cycleId: ID!): [CycleBurndownPoint!]!

  project(id: ID!): Project!
  projects(filter: ProjectFilter, first: Int, after: String, includeArchived: Boolean): ProjectConnection!

  customView(id: ID!): CustomView!
  customViews(teamId: String): [CustomView!]!
  documents(teamId: ID, projectId: ID): [Document!]!
  document(id: ID!): Document

  comments(issueId: ID!, includeArchived: Boolean): [Comment!]!

  notifications(limit: Int): [Notification!]!
  notificationUnreadCount: Int!

  customFieldDefinitions(teamId: String!, includeArchived: Boolean): [CustomFieldDefinition!]!
  customFieldValuesForIssue(issueId: ID!): [CustomFieldValue!]!

  publicRoadmap: PublicRoadmap
  publicRoadmapPage(slug: String!, password: String): PublicRoadmapPage!
}

type Mutation {
  # Auth
  emailLogin(input: EmailLoginInput!): EmailLoginPayload!
  emailVerify(input: EmailVerifyInput!): AuthPayload!
  googleAuthExchange(code: String!, redirectUri: String!): AuthPayload!
  tokenRefresh(refreshToken: String!): AuthPayload!
  logout: LogoutPayload!

  # Issues, Projects, Cycles, Views, Documents, Comments, Custom Fields, ...
  # All follow {success, <entity>, lastSyncId} payload shape
  issueCreate(input: IssueCreateInput!): IssuePayload!
  ...
  publicRoadmapUpsert(input: PublicRoadmapUpsertInput!): PublicRoadmapUpsertResult!
}
```

> **There are no `syncBootstrap` / `syncDelta` GraphQL operations.** Sync is
> over REST (`GET /api/sync/bootstrap`, `GET /api/sync/delta`) because the
> payload is bulk JSON and bypasses the Apollo executor entirely. See the full
> API surface in `docs/API_DESIGN.md`.

### 5.2 Service Layer

```
┌──────────────────────────────────────────────────────────┐
│                    GraphQL Resolvers                      │
│  (thin: requireAuth(ctx) → ctx.services.*.call()         │
│   → remap service errors to GraphQLError extensions.code)│
└───────────────────────┬──────────────────────────────────┘
                        │
┌───────────────────────┴──────────────────────────────────┐
│                     Domain Services                       │
│                                                           │
│  auth.service                — magic link, OAuth, JWT     │
│  user.service                — profile, org membership    │
│  team.service                — CRUD, settings, cycles cfg │
│  workflow-state.service      — state CRUD                 │
│  label.service               — label CRUD                 │
│  issue.service               — CRUD, relations, sub-issue │
│                                 cascade, project/cycle    │
│                                 inheritance               │
│  issue-activity.service      — change log writer          │
│  issue-relation.service      — blocks / related / dupe    │
│  issue-template.service      — team-scoped templates      │
│  project.service             — projects, milestones,      │
│                                 updates, team/member join │
│  cycle.service               — CRUD, velocity, burndown,  │
│                                 manual rollover           │
│  custom-view.service         — view CRUD                  │
│  custom-field.service        — definitions + values,      │
│                                 type validation           │
│  comment.service             — threaded comments,         │
│                                 resolve / reactions       │
│  notification.service        — fanout, snooze,            │
│                                 mark-read, subscribe      │
│  document.service            — docs w/ parent hierarchy   │
│  file.service                — upload storage, delete     │
│  roadmap.service             — public roadmap upsert +    │
│                                 /r/:slug page assembly    │
│  search.service              — full-text search via       │
│                                 Postgres FTS              │
│  sync.service                — SyncAction writer +        │
│                                 Redis Pub/Sub broadcaster │
└───────────────────────┬──────────────────────────────────┘
                        │
┌───────────────────────┴──────────────────────────────────┐
│                   Data Access Layer                       │
│  Prisma 7 Client with @prisma/adapter-pg driver adapter   │
└──────────────────────────────────────────────────────────┘
```

Not yet extracted: **WebhookService** (§5.4 BullMQ queues), **IntegrationService**
(Slack / GitHub), **ApiKeyService** — all planned.

### 5.3 Sync Broadcast Pipeline

```
Mutation executed
    │
    ▼
┌─────────────────┐
│ Write to DB     │
│ (PostgreSQL)    │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Create SyncAction│
│ (sequential ID) │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Publish to Redis│
│ PubSub channel  │
└────────┬────────┘
         │
    ┌────┴────┐
    ▼         ▼
┌───────┐ ┌───────┐
│ WS    │ │ WS    │  (All WebSocket server instances
│ Srv 1 │ │ Srv 2 │   subscribe to Redis channel)
└───┬───┘ └───┬───┘
    │         │
    ▼         ▼
  Clients   Clients
```

### 5.4 Background Job Processing 🔲 Planned

BullMQ queues are **not yet wired**. Today the jobs that would live here run
inline in the request-response path or on explicit user trigger:

| Work                            | Current implementation                         |
|---------------------------------|------------------------------------------------|
| Magic-link email send           | Inline in `AuthService.requestMagicLink` (dev logs to console) |
| Notification fanout             | Inline in the mutation path, before SyncAction broadcast       |
| Cycle rollover                  | Button → `cycleRollover` GraphQL mutation (user-initiated)     |
| Sync action cleanup             | Not implemented; rows accumulate                               |
| Full-text search index          | Postgres FTS GIN index updated automatically by triggers       |

Planned queues (Sprint 37+):

```
BullMQ Queues:
├── webhook-dispatch   → outbound webhooks with retry (1m, 1h, 6h)
├── email-send         → async magic links, notifications, digests
├── notification       → deferred fanout for busy mutations
├── sync-cleanup       → purge old SyncActions (>30 days)
├── import             → bulk issue import from Jira / CSV
└── auto-archive       → periodic auto-close / archive scan
```

---

## 6. Security Architecture

### 6.1 Authentication Flow

```
Email Magic Link:
  1. User enters email → emailLogin GraphQL mutation (POST /api/graphql)
  2. Server generates cryptographically random 6-digit code (crypto.randomInt)
  3. Code is hashed (SHA-256) before storage — raw code only in the email
  4. Email sent with code (dev: logged to console)
  5. User enters code → emailVerify GraphQL mutation
  6. Server looks up by tokenHash; returns access token (24h) + refresh token (30d)
  7. Client POSTs tokens to /api/auth/session → server sets httpOnly cookies

Google OAuth:
  1. Client redirects to Google OAuth consent screen
  2. Google redirects to /auth/google/callback with authorization code
  3. googleAuthExchange GraphQL mutation — server exchanges code for Google tokens
  4. Server creates or links user account
  5. Returns access + refresh tokens (same cookie flow as above)

Token Refresh:
  1. Client detects 401 or token expiry approaching
  2. tokenRefresh GraphQL mutation with refresh token
  3. Server issues new access + refresh tokens
  4. 30-minute grace period on old refresh token (handles concurrent requests)

Token Security:
  - Refresh tokens stored as SHA-256 hashes only (never plaintext)
  - Pre-generated UUID ensures DB record and JWT are written atomically
  - Access tokens: HS256 JWT, 24h, payload {userId, orgId, type:'access'}
  - Refresh tokens: HS256 JWT, 30d, payload {userId, tokenId, type:'refresh'}
  - httpOnly cookies prevent XSS access; separate JWT_SECRET / JWT_REFRESH_SECRET
```

### 6.2 Authorization Model

```
Workspace Level:
  Owner > Admin > Member > Guest

Team Level:
  Team Owner > Team Member

Permission checks in resolvers:
  1. Authenticate (JWT verification)
  2. Workspace membership check
  3. Team access check (private teams)
  4. Role-based action check
  5. Entity-level ownership check (where applicable)
```

### 6.3 Data Security

- **Encryption at rest:** PostgreSQL with disk encryption (infra concern)
- **Encryption in transit:** TLS 1.3 everywhere
- **Token hashing:** SHA-256 of the raw token only; plaintext never stored. Public-roadmap passwords use the same scheme.
- **Rate limiting:** Redis fixed-window per user on `/api/graphql`, stricter per-IP on `/api/auth/*`
- **Input validation:** GraphQL input types + service-layer checks (Zod where applicable)
- **SQL injection:** Prevented by Prisma parameterized queries
- **XSS:** React auto-escaping + CSP headers + sanitized TipTap / markdown rendering
- **API keys / webhook HMAC signing:** 🔲 Planned (see §5.4)

---

## 7. Deployment Architecture

```
                    ┌─────────────┐
                    │ Cloudflare  │
                    │ CDN / WAF   │
                    └──────┬──────┘
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
       ┌──────────┐ ┌──────────┐ ┌──────────┐
       │ Frontend │ │ API      │ │ WebSocket│
       │ (Vercel) │ │ Servers  │ │ Servers  │
       │          │ │ (2+ inst)│ │ (2+ inst)│
       └──────────┘ └────┬─────┘ └────┬─────┘
                         │            │
                    ┌────┴────────────┴────┐
                    │                       │
              ┌─────┴─────┐         ┌──────┴──────┐
              │ PostgreSQL │         │    Redis    │
              │ (Primary + │         │ (Cluster)  │
              │  Read      │         └─────────────┘
              │  Replicas) │
              └────────────┘
```

### 7.1 Scaling Strategy

- **Frontend:** Vercel edge deployment, global CDN
- **API servers:** Horizontal scaling behind load balancer
- **WebSocket servers:** Sticky sessions per user, Redis pub/sub for cross-instance broadcast
- **Database:** Primary + read replicas; connection pooling via PgBouncer
- **Redis:** Cluster mode for pub/sub scalability
- **Search:** Dedicated MeiliSearch instance or PostgreSQL FTS with GIN indexes

---

## 8. Key Design Decisions

| Decision   | Choice            | Alternatives Considered    | Rationale                                                                 |
| ---------- | ----------------- | -------------------------- | ------------------------------------------------------------------------- |
| API        | GraphQL           | REST, tRPC                 | Matches Linear, flexible queries, typed schema                            |
| State      | MobX              | Zustand, Redux, Jotai      | Observable reactivity for sync engine, fine-grained updates               |
| Local DB   | IndexedDB/Dexie   | OPFS, SQLite/WASM          | Browser support, async, proven at scale                                   |
| Backend DB | PostgreSQL        | MongoDB, CockroachDB       | Relational integrity, JSONB flexibility, mature                           |
| Real-time  | WebSocket         | SSE, polling, WebTransport | Bidirectional, low latency, proven                                        |
| Sync       | Custom delta sync | CRDTs, OT, Replicache      | Linear's proven approach, simpler than CRDTs                              |
| ORM        | Prisma 7          | Drizzle, TypeORM, Knex     | Rust-free client, type-safe, built-in Studio, excellent migration tooling |
| Editor     | TipTap            | Slate, Lexical, Quill      | ProseMirror-based, collaborative editing support                          |
| Auth       | Custom JWT        | NextAuth, Clerk, Auth0     | Full control over token lifecycle, sync engine integration                |
| Queue      | BullMQ            | RabbitMQ, SQS, Inngest     | Redis-backed, simple, good DX                                             |
