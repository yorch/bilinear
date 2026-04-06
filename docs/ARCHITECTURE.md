# Architecture Design Document
## Issue Tracker — Linear Rebuild

**Version:** 1.0  
**Date:** April 2026

---

## 1. System Architecture Overview

```
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
| Layer | Technology | Rationale |
|-------|-----------|-----------|
| Framework | **Next.js 15 (App Router)** | SSR, routing, API routes, existing in repo |
| Language | **TypeScript** | Type safety, shared types with backend |
| State | **MobX** | Observable-based reactivity (matches Linear's approach) |
| Local DB | **IndexedDB** (via Dexie.js) | Offline-first local cache |
| Real-time | **WebSocket** (native) | Delta sync, low latency |
| Styling | **Tailwind CSS + shadcn/ui** | Rapid UI development (already in repo) |
| Editor | **TipTap** (ProseMirror) | Rich text with collaborative editing |
| Virtualization | **TanStack Virtual** | 60fps scrolling for large lists |
| DnD | **@dnd-kit** | Accessible drag-and-drop |
| Date | **date-fns** | Lightweight date utilities |
| Charts | **Recharts** | Progress/velocity charts |

### 2.2 Backend
| Layer | Technology | Rationale |
|-------|-----------|-----------|
| Runtime | **Node.js** | TypeScript everywhere, shared types |
| API | **GraphQL** (Apollo Server or Yoga) | Matches Linear's approach, flexible queries |
| ORM | **Drizzle ORM** | Type-safe, lightweight, PostgreSQL-native |
| Database | **PostgreSQL 16** | Relational, JSONB, full-text search, mature |
| Cache/PubSub | **Redis 7** | Pub/sub for sync broadcast, session cache, rate limiting |
| Search | **MeiliSearch** or **PostgreSQL FTS** | Full-text search with fuzzy matching |
| File Storage | **S3-compatible** (AWS S3 / Cloudflare R2) | Attachment storage |
| Auth | **Custom JWT + OAuth2** | Magic links, Google OAuth, SAML |
| Queue | **BullMQ** (Redis-backed) | Background jobs: webhooks, emails, imports |
| WebSocket | **ws** library | Raw WebSocket for sync engine |

### 2.3 Infrastructure
| Layer | Technology | Rationale |
|-------|-----------|-----------|
| Hosting | **Vercel** (frontend) + **Railway/Fly.io** (backend) | Or self-hosted Kubernetes |
| CI/CD | **GitHub Actions** | Automated testing, deployment |
| Monitoring | **Sentry** (errors) + **Prometheus/Grafana** (metrics) | Observability |
| CDN | **Cloudflare** | Static assets, edge caching |

---

## 3. Sync Engine Architecture

The sync engine is the most critical technical component. It enables the <50ms interaction times that define the product.

### 3.1 Design Principles
1. **Local-first:** All reads come from local IndexedDB; UI never waits for network
2. **Optimistic writes:** Mutations applied locally immediately, synced async
3. **Server-authoritative:** Server is source of truth; conflicts resolved by last-writer-wins
4. **Delta sync:** After initial bootstrap, only changes are transmitted

### 3.2 Data Flow

```
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
  id: number;          // Monotonically increasing (server-assigned)
  action: 'I' | 'U' | 'D' | 'A';  // Insert, Update, Delete, Archive
  modelName: string;   // Entity type (e.g., "Issue", "Comment")
  modelId: string;     // UUID of affected entity
  data: object | null; // Full/partial state (null for deletes)
}
```

### 3.4 Bootstrap Process

```
Phase 1 (Full Bootstrap):
  GET /sync/bootstrap?type=full
  → Returns all "instant-load" models:
    Organization, Team, User, Issue, Project, Cycle,
    WorkflowState, IssueLabel, Template, Favorite, CustomView
  → Response: line-delimited ModelName=<JSON>
  → Ends with _metadata_={lastSyncId: N}

Phase 2 (Partial Bootstrap):
  GET /sync/bootstrap?type=partial
  → Returns deferred models:
    Comment, IssueHistory, Attachment
  → Same format as Phase 1

Phase 3 (Real-time):
  WebSocket connection established
  → Server pushes: {cmd: "sync", sync: [...SyncActions], lastSyncId: N}
  → Client applies deltas to local store

Reconnection (Delta Sync):
  GET /sync/delta?lastSyncId=X&toSyncId=Y
  → Returns SyncActions in range [X, Y]
  → Client catches up from last known position
```

### 3.5 Model Load Strategies
| Strategy | When Loaded | Examples |
|----------|-------------|---------|
| `instant` | Full bootstrap | Issue, Team, User, Project |
| `partial` | Partial bootstrap | Comment, IssueHistory |
| `lazy` | On demand | Attachment content |
| `local` | Client-only | UI state, drafts |

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
│           │   ├── Inbox
│           │   ├── Favorites
│           │   └── TeamNav (per team)
│           │       ├── Issues
│           │       ├── Cycles
│           │       ├── Projects
│           │       └── Views
│           ├── MainContent
│           │   ├── ListView
│           │   │   ├── FilterBar
│           │   │   ├── GroupHeader
│           │   │   └── IssueRow (virtualized)
│           │   ├── BoardView
│           │   │   ├── BoardColumn
│           │   │   └── IssueCard (draggable)
│           │   └── TimelineView
│           │       └── TimelineBar
│           ├── DetailPanel
│           │   ├── IssueMetadata
│           │   ├── DescriptionEditor (TipTap)
│           │   ├── SubIssueList
│           │   ├── RelationsList
│           │   └── ActivityFeed
│           │       ├── Comment
│           │       └── HistoryEntry
│           ├── CommandPalette (Cmd+K)
│           ├── CreateIssueModal
│           └── NotificationToasts
```

### 4.2 State Management (MobX)

```typescript
// Core stores
class RootStore {
  authStore: AuthStore;
  syncStore: SyncStore;          // Manages sync engine
  workspaceStore: WorkspaceStore;
  issueStore: IssueStore;        // Issues indexed by ID
  projectStore: ProjectStore;
  cycleStore: CycleStore;
  teamStore: TeamStore;
  userStore: UserStore;
  labelStore: LabelStore;
  viewStore: ViewStore;
  notificationStore: NotificationStore;
  uiStore: UIStore;              // Sidebar state, active view, selection
}

// Each entity store follows a common pattern:
class IssueStore {
  // Object Pool: Map<UUID, Issue>
  pool: Map<string, Issue>;

  // MobX computed getters with filters
  get activeIssues(): Issue[];
  get byTeam(teamId: string): Issue[];
  get byProject(projectId: string): Issue[];

  // Sync integration
  applySyncAction(action: SyncAction): void;
  save(issue: Issue): Promise<void>;  // optimistic + queue
}
```

### 4.3 Routing

```
/                          → Redirect to default home view
/[workspace]               → Workspace home
/[workspace]/inbox         → Notification inbox
/[workspace]/my-issues     → My assigned issues

/[workspace]/team/[key]           → Team issues (default view)
/[workspace]/team/[key]/active    → Active issues
/[workspace]/team/[key]/backlog   → Backlog
/[workspace]/team/[key]/triage    → Triage inbox
/[workspace]/team/[key]/cycles    → Cycles list
/[workspace]/team/[key]/projects  → Projects list
/[workspace]/team/[key]/views     → Custom views

/[workspace]/issue/[ID]           → Issue detail (e.g., ENG-123)
/[workspace]/project/[slug]       → Project detail
/[workspace]/cycle/[id]           → Cycle detail
/[workspace]/view/[id]            → Custom view

/[workspace]/settings             → Workspace settings
/[workspace]/settings/teams/[key] → Team settings
```

---

## 5. Backend Architecture

### 5.1 GraphQL Schema Design

```graphql
type Query {
  # Viewer
  viewer: User!

  # Entities (single + paginated list)
  issue(id: ID!): Issue!
  issues(filter: IssueFilter, first: Int, after: String, orderBy: PaginationOrderBy): IssueConnection!
  project(id: ID!): Project!
  projects(filter: ProjectFilter, first: Int, after: String): ProjectConnection!
  team(id: ID!): Team!
  teams(filter: TeamFilter, first: Int, after: String): TeamConnection!
  cycle(id: ID!): Cycle!
  cycles(filter: CycleFilter, first: Int, after: String): CycleConnection!

  # Search
  searchIssues(query: String!, first: Int): IssueConnection!

  # Organization
  organization: Organization!

  # Sync
  syncBootstrap(type: BootstrapType!, onlyModels: [String!]): SyncBootstrapResponse!
  syncDelta(lastSyncId: Int!, toSyncId: Int): SyncDeltaResponse!
}

type Mutation {
  # Issues
  issueCreate(input: IssueCreateInput!): IssuePayload!
  issueUpdate(id: ID!, input: IssueUpdateInput!): IssuePayload!
  issueArchive(id: ID!): IssuePayload!
  issueDelete(id: ID!): DeletePayload!

  # Comments
  commentCreate(input: CommentCreateInput!): CommentPayload!
  commentUpdate(id: ID!, input: CommentUpdateInput!): CommentPayload!
  commentDelete(id: ID!): DeletePayload!

  # Projects, Cycles, Labels, etc. follow same pattern
  # ...

  # Auth
  emailLogin(email: String!): EmailLoginPayload!
  tokenExchange(code: String!): AuthPayload!
  logout: LogoutPayload!
}
```

### 5.2 Service Layer

```
┌──────────────────────────────────────────────────┐
│                 GraphQL Resolvers                 │
│  (thin layer: auth check → delegate to service)  │
└───────────────────────┬──────────────────────────┘
                        │
┌───────────────────────┴──────────────────────────┐
│                 Domain Services                   │
│                                                   │
│  IssueService     - CRUD, relations, sub-issues  │
│  ProjectService   - CRUD, milestones, updates    │
│  CycleService     - CRUD, auto-rollover          │
│  TeamService      - CRUD, membership, settings   │
│  AuthService      - Login, OAuth, tokens         │
│  SyncService      - Bootstrap, delta, broadcast  │
│  NotifService     - Create, deliver, subscribe   │
│  WebhookService   - Dispatch, retry, verify      │
│  SearchService    - Index, query, rank           │
│  IntegrationSvc   - GitHub, Slack connectors     │
└───────────────────────┬──────────────────────────┘
                        │
┌───────────────────────┴──────────────────────────┐
│               Data Access Layer                   │
│  (Drizzle ORM: type-safe queries, migrations)    │
└──────────────────────────────────────────────────┘
```

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

### 5.4 Background Job Processing

```
BullMQ Queues:
├── webhook-dispatch   → Send webhook payloads with retry (1m, 1h, 6h)
├── email-send         → Magic links, notifications, digests
├── notification       → Create and fan-out notifications
├── sync-cleanup       → Purge old SyncActions (>30 days)
├── import             → Bulk issue import from Jira/CSV
├── search-index       → Update search index on entity changes
└── auto-archive       → Periodic auto-close/archive scan
```

---

## 6. Security Architecture

### 6.1 Authentication Flow

```
Email Magic Link:
  1. User enters email → POST /auth/email
  2. Server generates 6-digit code + JWT token (15min expiry)
  3. Email sent with code
  4. User enters code → POST /auth/verify
  5. Server returns access token (24h) + refresh token (30d)
  6. Client stores tokens in httpOnly cookies

Google OAuth:
  1. Client redirects to Google OAuth consent
  2. Google redirects back with authorization code
  3. Server exchanges code for Google tokens
  4. Server creates/links user account
  5. Returns access + refresh tokens

Token Refresh:
  1. Client detects 401 or token expiry approaching
  2. POST /auth/refresh with refresh token
  3. Server issues new access + refresh tokens
  4. 30-minute grace period on old refresh token
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
- **Encryption at rest:** PostgreSQL with disk encryption
- **Encryption in transit:** TLS 1.3 everywhere
- **API keys:** Hashed with bcrypt, prefixed with `lin_api_`
- **Webhook secrets:** HMAC-SHA256 signatures
- **Rate limiting:** Per-user, per-IP, per-endpoint
- **Input validation:** GraphQL input types + Zod schemas
- **SQL injection:** Prevented by Drizzle ORM parameterized queries
- **XSS:** React auto-escaping + CSP headers + sanitized markdown

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

| Decision | Choice | Alternatives Considered | Rationale |
|----------|--------|------------------------|-----------|
| API | GraphQL | REST, tRPC | Matches Linear, flexible queries, typed schema |
| State | MobX | Zustand, Redux, Jotai | Observable reactivity for sync engine, fine-grained updates |
| Local DB | IndexedDB/Dexie | OPFS, SQLite/WASM | Browser support, async, proven at scale |
| Backend DB | PostgreSQL | MongoDB, CockroachDB | Relational integrity, JSONB flexibility, mature |
| Real-time | WebSocket | SSE, polling, WebTransport | Bidirectional, low latency, proven |
| Sync | Custom delta sync | CRDTs, OT, Replicache | Linear's proven approach, simpler than CRDTs |
| ORM | Drizzle | Prisma, TypeORM, Knex | Lightweight, type-safe, SQL-close |
| Editor | TipTap | Slate, Lexical, Quill | ProseMirror-based, collaborative editing support |
| Auth | Custom JWT | NextAuth, Clerk, Auth0 | Full control over token lifecycle, sync engine integration |
| Queue | BullMQ | RabbitMQ, SQS, Inngest | Redis-backed, simple, good DX |
