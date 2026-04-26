# Code Patterns

## Issue Tracker — Linear Rebuild

**Established:** Sprint 1-2
**Last updated:** 2026-04-17 (Sprints 35-36 + Public Roadmaps)
**Status:** Living document — updated each sprint

> This is the primary onboarding document for new contributors. All patterns here are the mandated conventions for the codebase. If you deviate from a pattern, document why.

---

## 1. Project Structure

```
src/
├── app/                        # Next.js App Router (pages + API routes)
│   ├── (auth)/                 # Route group: no sidebar, centered layout
│   ├── (workspace)/            # Route group: authenticated, sidebar layout
│   ├── r/                      # Public roadmap route (unauthenticated, /r/:slug)
│   └── api/                    # GraphQL, auth/session, sync/{bootstrap,delta}, upload, uploads/[...path]
├── server/                     # Backend-only code — never import from client
│   ├── graphql/                # schema.ts, context.ts, resolvers/ (per-domain), types/
│   ├── services/               # Business logic — one class per domain (see §5)
│   ├── lib/                    # Singletons: prisma, redis, jwt, email, logger, tiptap-schema
│   ├── middleware/             # Auth extraction + guards
│   └── ws/                     # Standalone WebSocket server (separate process)
├── stores/                     # MobX observable entity pools
├── providers/                  # React context wrappers (StoreProvider, SyncProvider)
├── components/                 # React components (client-safe)
│   ├── ui/                     # shadcn/ui primitives
│   ├── layouts/                # App shell, sidebar, WorkspaceClient
│   ├── command-palette/        # CommandPalette modal (Sprint 9-10)
│   ├── auth/                   # Login forms
│   ├── issues/                 # Issue list, detail panel, create modal, comments, file attachments
│   ├── views/                  # CustomView pages, filter builder, column picker, CSV export
│   ├── properties/             # Selectors (status, assignee, priority, label, project, cycle)
│   ├── cycles/                 # Cycle list/detail, burndown chart, rollover
│   ├── projects/               # Project list/detail, milestones, updates
│   ├── custom-fields/          # Custom field definition settings + detail panel editors
│   ├── notifications/          # Notification bell + inbox list
│   ├── editor/                 # TipTap extension set (mention, slash, mermaid, embed, details)
│   ├── documents/              # Document tree, editor page
│   ├── roadmap/                # Public roadmap page + config UI
│   └── teams/                  # Team member management, team settings
├── hooks/                      # useAuth, useHotkeys, useChord, useRecentItems, ...
├── lib/                        # Shared client utilities
│   ├── db.ts                   # Dexie.js IndexedDB schema
│   ├── fuzzy-search.ts         # Local fuzzy match for store search
│   ├── sync-manager.ts         # Sync lifecycle orchestrator
│   ├── transaction-queue.ts    # Serial mutation queue
│   ├── ws-client.ts            # WebSocket client
│   ├── csv-export.ts           # Flat-row exporter for issue lists
│   ├── graphql.ts              # Shared fetch helper
│   ├── toast.ts                # sonner wrapper — never import sonner directly
│   └── utils.ts / issue-utils.ts
└── types/                      # Shared frontend type definitions (issues.ts, filter-composition.ts)
```

**Rule:** Nothing under `src/server/` may be imported by client components. Server-only code uses Node.js APIs and database access that cannot run in the browser.

---

## 2. Prisma Pattern (Prisma 7)

Prisma 7 removed the `url` property from `datasource` in `schema.prisma`. The database URL lives in two places:

- **`prisma.config.ts`** (project root) — used by CLI commands (`migrate`, `generate`, `studio`)
- **`src/server/lib/prisma.ts`** — used at runtime via `@prisma/adapter-pg`

```typescript
// src/server/lib/prisma.ts — singleton pattern
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
export const prisma = globalForPrisma.prisma ?? new PrismaClient({ adapter });
```

```typescript
// prisma.config.ts — CLI datasource config
import { defineConfig } from 'prisma/config';
export default defineConfig({
  datasource: { url: process.env.DATABASE_URL },
});
```

**Generated client:** `src/generated/prisma/` is gitignored. Always run `yarn prisma generate` after checkout or schema changes.

### Model Conventions

Every model must follow these conventions (see `DATABASE_SCHEMA.md` section 1):

| Convention               | Example                                                    |
| ------------------------ | ---------------------------------------------------------- |
| UUID primary keys        | `id String @id @default(uuid()) @db.Uuid`                  |
| Soft delete              | `archivedAt DateTime? @map("archived_at") @db.Timestamptz` |
| Audit timestamps         | `createdAt / updatedAt` on every model                     |
| snake_case DB mapping    | `@map("url_key")`, `@@map("organizations")`                |
| Timezone-aware datetimes | `@db.Timestamptz` (not `@db.Timestamp`)                    |

### Date iteration — stay in one TZ domain

`@db.Timestamptz` columns come back as UTC `Date` objects. When iterating
days (e.g. burndown charts) pick one TZ domain and stay in it — mixing
local and UTC accessors causes off-by-one bugs on non-UTC machines:

```ts
// Bad: mixes local-time mutation with UTC serialization.
current.setHours(0, 0, 0, 0);
points.push({ date: current.toISOString().slice(0, 10), ... });

// Good: UTC everywhere (pair with setUTCDate for iteration).
current.setUTCHours(0, 0, 0, 0);
points.push({ date: current.toISOString().slice(0, 10), ... });
current.setUTCDate(current.getUTCDate() + 1);
```

CI typically runs in UTC, so this class of bug only reproduces on
developer machines in non-UTC zones. See `CycleService.getBurndown`.

### Nullable JSON columns

Prisma's `Json?` columns accept `Prisma.InputJsonValue` on write. Two
gotchas for service-layer code:

- Plain arrays of typed objects (e.g. `CustomFieldOption[]`) don't
  satisfy `InputJsonValue` because the type wants an index signature.
  Cast via `as unknown as Prisma.InputJsonValue` when the value is
  non-null.
- To explicitly clear a nullable JSON column, assign `Prisma.JsonNull`
  (not the literal `null`) — plain `null` is rejected by the compile-
  time type.

See `CustomFieldService.createDefinition` / `updateDefinition` for the
canonical pattern.

---

## 3. GraphQL Resolver Pattern

Resolvers are **thin layers** that authenticate and then delegate to services. No business logic in resolvers.

```typescript
// Pattern: authenticate → delegate → return
const resolvers = {
  Query: {
    viewer: async (_parent, _args, ctx: GraphQLContext) => {
      requireAuth(ctx);                          // throws UNAUTHENTICATED if no token
      return ctx.services.user.findById(ctx.userId);
    },
  },
  Mutation: {
    emailLogin: async (_parent, { input }, ctx: GraphQLContext) => {
      return ctx.services.auth.sendMagicLink(input.email);
      // no try/catch unless re-mapping error codes
    },
  },
};
```

**Field resolvers** handle GraphQL field → DB field mapping:

```typescript
User: {
  avatarBackgroundColor: (user: User) => user.avatarBgColor,  // rename
  isMe: (user: User, _args, ctx) => user.id === ctx.userId,   // computed
},
AuthPayload: {
  user: async (parent: { userId: string }, _args, ctx) =>     // hydrate
    ctx.services.user.findById(parent.userId),
},
```

---

## 4. Service Layer Pattern

Services encapsulate all business logic and database access. They receive dependencies via constructor injection and return domain objects.

```typescript
export class AuthService {
  constructor(
    private prisma: PrismaClient,
    private userService: UserService,
  ) {}

  async sendMagicLink(email: string): Promise<EmailLoginPayload> {
    // all logic here — no GraphQL types, no HTTP concerns
  }
}
```

**Rules:**

- Services only import from `src/generated/prisma`, `src/server/lib/`, and other services
- Services return plain objects / Prisma model types — never GraphQL response types
- Error classes are defined in the service file that throws them (see §6)
- **Don't create a service just to wrap a single `findUnique` call.** Create a service when there is real business logic to encapsulate (validation, transactions, constraints, seeding). A bare pass-through adds indirection with no value.

> **Note:** `OrganizationService` now owns org create/member-role logic (`createWithOwner`, `updateMemberRole`, `findMembers`). Field resolvers like `Team.organization` may still call `ctx.prisma.organization.findUnique` directly for simple lookups; promote into the service when business logic accretes around them.

---

## 5. GraphQL Context Pattern

Context is built per-request from the incoming headers/cookies:

```typescript
// src/server/graphql/context.ts (abbreviated; see the file for the full list)
export interface GraphQLContext extends AuthContext {
  prisma: PrismaClient;
  search: SearchService;
  services: {
    auth: AuthService;
    user: UserService;
    team: TeamService;
    workflowState: WorkflowStateService;
    label: LabelService;
    issue: IssueService;
    issueActivity: IssueActivityService;
    issueRelation: IssueRelationService;
    issueTemplate: IssueTemplateService;
    project: ProjectService;
    cycle: CycleService;
    customView: CustomViewService;
    customField: CustomFieldService;
    comment: CommentService;
    notification: NotificationService;
    document: DocumentService;
    file: FileService;
    roadmap: RoadmapService;
    sync: SyncService;      // SyncAction writer + Redis broadcaster
  };
}
```

Every domain with a GraphQL resolver has a matching service in
`src/server/services/`. When adding a new domain, wire the service into
`createContext` — resolvers never `new` a service on the fly and never call
`ctx.prisma` for business logic (auth guards are the exception).

The `prisma` instance is exposed on context so authorization guards can perform queries without going through a service (e.g., `requireOrgRole` checks `organizationMember` directly).

---

## 6. Error Handling Pattern

Use `GraphQLError` with `extensions.code` as the **canonical error discriminator**. Clients must check `extensions.code`, not HTTP status or message text.

```typescript
import { GraphQLError } from 'graphql';

// Standard codes used in this codebase:
throw new GraphQLError('Not authenticated',  { extensions: { code: 'UNAUTHENTICATED' } });
throw new GraphQLError('Not found',          { extensions: { code: 'NOT_FOUND' } });
throw new GraphQLError('Invalid code',       { extensions: { code: 'INVALID_CODE' } });
throw new GraphQLError('Invalid token',      { extensions: { code: 'INVALID_TOKEN' } });
throw new GraphQLError('OAuth failed',       { extensions: { code: 'OAUTH_ERROR' } });
```

**Internal error classes** (service-level, not exported):

```typescript
class InvalidCodeError extends Error {
  constructor() {
    super('Invalid or expired verification code');
    this.name = 'InvalidCodeError';  // checked by resolver catch blocks
  }
}
```

Resolvers catch service errors and re-map them to `GraphQLError` with the appropriate code.

---

## 7. Token Security Pattern

All sensitive values follow the same hash-before-store principle:

```typescript
// NEVER store raw tokens/codes in the database
function hashToken(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

// Generate codes with CSPRNG — not Math.random()
const code = String(crypto.randomInt(100000, 1000000));

// Pre-generate UUID to avoid two-step DB writes
const tokenId = crypto.randomUUID();
const refreshToken = await signRefreshToken({ tokenId, userId });
await prisma.authToken.create({
  data: { id: tokenId, tokenHash: hashToken(refreshToken), ... }
});
// Single write — no 'pending' placeholder needed
```

**Verification always hashes the input** and compares hashes — never queries by raw value:

```typescript
const tokenHash = hashToken(submittedCode);
const token = await prisma.authToken.findFirst({ where: { tokenHash, ... } });
```

---

## 8. Authentication Middleware Pattern

`requireAuth` uses TypeScript's `asserts` narrowing so resolvers are typed after the guard:

```typescript
export function requireAuth(ctx: AuthContext): asserts ctx is { userId: string; orgId: string } {
  if (!ctx.userId) {
    throw new GraphQLError('Not authenticated', { extensions: { code: 'UNAUTHENTICATED' } });
  }
}

// After requireAuth(ctx), TypeScript knows ctx.userId is string (not null)
```

The Next.js edge middleware (`src/middleware.ts`) guards all non-public routes **before** any React rendering. Public paths are whitelisted in `PUBLIC_PATHS`:

```typescript
const PUBLIC_PATHS = ['/login', '/verify', '/api/graphql', '/auth/google', '/_next', '/favicon.ico'];
```

**Never fall back to an empty JWT secret:**

```typescript
// ✅ Correct
const jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret) return NextResponse.redirect(new URL('/login', req.url));

// ❌ Wrong — accepts tokens signed with '' if env var is unset
const secret = new TextEncoder().encode(process.env.JWT_SECRET ?? '');
```

---

## 9. Session Cookie Pattern

Tokens returned from GraphQL mutations are not automatically stored. The client must call `POST /api/auth/session` which verifies the token and sets `httpOnly` cookies:

```
emailVerify mutation → { accessToken, refreshToken }
    ↓
POST /api/auth/session { accessToken, refreshToken }
    ↓ (server verifies JWT signature before accepting)
Set-Cookie: access_token=...; HttpOnly; SameSite=Lax
Set-Cookie: refresh_token=...; HttpOnly; SameSite=Lax
```

This two-step design keeps cookie logic out of the GraphQL layer and makes it easy to reuse auth mutations from non-browser clients that don't need cookies.

---

## 10. Environment Variable Pattern

All required env vars are checked at the call site — never silently defaulted:

```typescript
// src/server/lib/jwt.ts — guard pattern
function getSecret(key: string): Uint8Array {
  const secret = process.env[key];
  if (!secret) throw new Error(`Missing environment variable: ${key}`);
  return new TextEncoder().encode(secret);
}
```

Required variables are documented in `.env.example`. Optional variables have sensible defaults (e.g., `REDIS_URL` defaults to `redis://localhost:6379`).

---

## 11. Performance Patterns

### Debounce frequent writes

Avoid DB writes on every request for values that change slowly:

```typescript
// updateLastSeen — skip if already written within 5 minutes
async updateLastSeen(userId: string, currentLastSeen: Date | null): Promise<void> {
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
  if (currentLastSeen && currentLastSeen > fiveMinutesAgo) return;
  await this.prisma.user.update({ data: { lastSeen: new Date() }, where: { id: userId } });
}
```

### Prisma singleton

The Prisma client is a module-level singleton to reuse the connection pool across requests in both dev (HMR) and production:

```typescript
const globalForPrisma = globalThis as unknown as { prisma: PrismaClient | undefined };
export const prisma = globalForPrisma.prisma ?? createPrismaClient();
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
```

### DataLoader for GraphQL field resolvers

Field resolvers like `Issue.assignee` fire one DB lookup per parent row. To avoid N+1, the GraphQL context exposes a per-request `loaders` bundle (`src/server/graphql/loaders.ts`) that batches `findUnique` calls within a single tick into one `findMany({ where: { id: { in: [...] } } })`.

```typescript
// Field resolver — batched
Issue: {
  assignee: (issue, _args, ctx) =>
    issue.assigneeId ? ctx.loaders.user.load(issue.assigneeId) : null,
}
```

**Use loaders in field resolvers; keep `services.<x>.findById` for mutation auth lookups** (single-shot calls don't benefit from batching). Loaders are built fresh per request inside `createContext` so there is no cross-request cache leakage.

---

## 12. Frontend Data Pattern (Sprint 7-8+)

From Sprint 7-8 onward, the team page and all new workspace pages read from **MobX stores** instead of issuing GraphQL queries directly. Writes go through the `TransactionQueue`.

```typescript
// Reading — use observer() + useMemo from stores
const TeamPage = observer(function TeamPage() {
  const { issueStore, labelStore } = useStore();  // from StoreProvider context

  const issues = useMemo(() => {
    return issueStore.findByTeamId(teamId).map(i => ({
      ...i,
      labels: (i.labelIds ?? [])
        .map(id => labelStore.findById(id))
        .filter(Boolean),
    }));
  }, [teamId, issueStore.pool.size, labelStore.pool.size]);  // observe pool.size, not the Map
});

// Writing — optimistic first, then enqueue mutation
const txQueue = useMemo(() => new TransactionQueue(), []);  // one per component mount

const handleUpdate = useCallback((id, patch) => {
  issueStore.optimisticUpdate(id, patch);  // instant UI update
  txQueue.enqueue(ISSUE_UPDATE_MUTATION, { id, input: patch }, {
    onSuccess: (data) => issueStore.applySyncAction('U', id, data.issueUpdate.issue),
    onError: () => console.error('rollback via next delta sync'),
  });
}, [issueStore, txQueue]);
```

**Rules:**

- Wrap page components with `observer()` from `mobx-react-lite` so they re-render on store changes
- Use `useMemo` with `store.pool.size` as a dependency — the Map itself is stable; `pool.size` changes when entries are added/removed
- Use `useStore()` to access the `RootStore` from context — never import `getRootStore()` directly in components
- `TransactionQueue` must be created per component mount with `useMemo(() => new TransactionQueue(), [])` — not at module level
- The frontend still does **not** use Apollo Client — mutations are plain template strings passed to `txQueue.enqueue()`
- Shared frontend types (`WorkflowState`, `IssueUser`, `IssueLabel`, `IssueBase`, `IssueDetail`) live in `src/types/issues.ts`
- DB entity types (`DBIssue`, `DBTeam`, etc.) live in `src/lib/db.ts` — these are the types stored in IndexedDB and MobX pools

---

## 14. Authorization Pattern (Sprint 3-4)

Role-based guards are standalone async functions that take the Prisma client and throw `GraphQLError` with `FORBIDDEN` code:

```typescript
// src/server/middleware/auth.ts — role-based guards
export async function requireOrgRole(prisma, orgId, userId, roles: string[]): Promise<void>
export async function requireTeamMember(prisma, teamId, userId): Promise<void>
export async function requireTeamOwner(prisma, teamId, userId): Promise<void>
```

Usage in resolvers:

```typescript
teamCreate: async (_parent, { input }, ctx) => {
  requireAuth(ctx);                                         // sync — throws UNAUTHENTICATED
  await requireOrgRole(ctx.prisma, ctx.orgId, ctx.userId, ['owner', 'admin']);  // async — throws FORBIDDEN
  const team = await ctx.services.team.create(ctx.orgId, ctx.userId, input);
  return { success: true, team, lastSyncId: 0 };
},
```

---

## 15. Entity CRUD Pattern (Sprint 3-4)

Every entity follows the same file structure and flow:

```
src/server/
├── services/<entity>.service.ts     # Business logic + Prisma queries
└── graphql/resolvers/<entity>.ts    # Thin resolver: auth → service → return
```

**Service layer** owns all business rules (validation, constraints, seeding):

```typescript
export class TeamService {
  constructor(private prisma: PrismaClient) {}

  async create(orgId: string, userId: string, input: TeamCreateInput): Promise<Team> {
    this.validateKey(input.key);           // Throws TeamKeyInvalidError
    return this.prisma.$transaction(async tx => {
      const team = await tx.team.create({ data: { ... } });
      await this.seedDefaultStates(tx, team.id, input.triageEnabled ?? false);
      await tx.teamMembership.create({ data: { isOwner: true, teamId: team.id, userId } });
      return team;
    });
  }
}
```

**Resolvers** catch service errors and remap to `GraphQLError`:

```typescript
} catch (err) {
  if ((err as Error).name === 'TeamKeyInvalidError') {
    throw new GraphQLError(err.message, { extensions: { code: 'BAD_USER_INPUT' } });
  }
  throw err;
}
```

**Mutation return types** include the real `lastSyncId` as a serialized string (BIGSERIAL → String to avoid 32-bit Int overflow):

```typescript
const sync = await ctx.services.sync.createSyncAction(ctx.orgId, 'I', 'Team', team.id, team);
return { success: true, team, lastSyncId: sync.id.toString() };
```

---

## 16. Testing Pattern (Sprint 3-4)

Tests use **Vitest** with mock Prisma clients. No real database is needed.

```
src/test/
├── setup.ts          # Environment vars + global mocks
├── prisma-mock.ts    # createMockPrisma() — mock models with vi.fn()
├── context-mock.ts   # createMockContext() — builds GraphQL context with mocks
└── fixtures.ts       # Shared test data (TEST_ORG, TEST_USER, TEST_TEAM, TEST_ISSUE, TEST_LABEL, etc.)
```

**Service tests** mock the Prisma client directly:

```typescript
const prisma = createMockPrisma();
const service = new TeamService(prisma as never);

prisma.team.create.mockResolvedValue(TEST_TEAM);
const result = await service.create(orgId, userId, input);
expect(prisma.workflowState.create).toHaveBeenCalledTimes(5);
```

**Resolver tests** use `createMockContext()` to test the full resolver → service flow:

```typescript
const ctx = createMockContext();
ctx.prisma.organizationMember.findUnique.mockResolvedValue({ role: 'admin', ... });
ctx.prisma.team.create.mockResolvedValue(TEST_TEAM);
const result = await teamResolvers.Mutation.teamCreate(null, { input }, ctx as never);
expect(result.success).toBe(true);
```

**Scripts:**

- `yarn vitest run` (or `yarn test`) — run all tests once
- `yarn test:coverage` — run with coverage report
- `yarn test:watch` — watch mode for development

**Mocking `SyncService` in tests:** The `MockSyncService` in `src/test/context-mock.ts` returns `{ id: BigInt(1) }`. Resolver tests should assert `lastSyncId === '1'` (string), not `0` (number).

---

## 17. MobX Store Pattern (Sprint 7-8)

Every entity store follows a uniform pattern with an object pool, computed getters, and sync integration:

```typescript
import { action, computed, makeObservable, observable } from 'mobx';
import type { DBTeam } from '@/lib/db';

export class TeamStore {
  pool = new Map<string, DBTeam>();  // Observable Map — entity pool

  constructor() {
    makeObservable(this, {
      all: computed,
      applySyncAction: action,
      optimisticUpdate: action,  // if applicable
      pool: observable,
      upsertMany: action,
    });
  }

  // Computed getters apply filters (archived, trashed)
  get all(): DBTeam[] {
    return Array.from(this.pool.values()).filter(t => !t.archivedAt);
  }

  // Initial bulk load from IndexedDB or bootstrap
  upsertMany(entities: DBTeam[]) {
    for (const e of entities) this.pool.set(e.id, e);
  }

  // Applied for both live WebSocket actions and delta sync catch-up
  applySyncAction(action: string, id: string, data: DBTeam | null) {
    if (action === 'I' || action === 'U' || action === 'A') {
      if (data) this.pool.set(id, data);
    } else if (action === 'D') {
      this.pool.delete(id);
    }
  }
}
```

**Rules:**

- All stores are created in `RootStore` constructor and accessed via `useStore()` in components
- `pool` is the single source of truth — never duplicate entity state elsewhere
- `applySyncAction` handles all four action types: I (Insert), U (Update), D (Delete), A (Archive)
- Archive (A) stores the entity with `archivedAt` set — the computed getters filter it out
- `IssueStore.applySyncAction` also extracts `labelIds` from the incoming data, which may include a `labelAssignments` array (full Prisma object from sync actions) or a `labelIds` array (from bootstrap data)

---

## 18. Sync Provider Pattern (Sprint 7-8)

The sync lifecycle is managed by two providers wrapping the workspace layout:

```
<StoreProvider>          ← creates RootStore singleton, provides via React context
  <SyncProvider>         ← bootstraps data, starts WsClient, teardown on unmount
    <AppShell />
  </SyncProvider>
</StoreProvider>
```

`SyncProvider` on mount:

1. Fetches JWT token from `GET /api/auth/session` (reads httpOnly cookie server-side)
2. Creates `SyncManager` and `WsClient`
3. Calls `syncManager.start(token)` which runs:
   - Load from IndexedDB → if cached, delta sync; otherwise full bootstrap
   - Connect WebSocket (`ws://host:3001?token=<jwt>`)
   - Register `online`/`offline` event listeners

On unmount, `syncManager.stop()` disconnects WebSocket and removes event listeners.

**WebSocket auth:** Browsers cannot set custom headers on WebSocket connections. The JWT is passed as a query parameter (`?token=<jwt>`). The WS server verifies it and maps the connection to an org.

---

## 19. SyncAction Generation Pattern (Sprint 7-8)

Every GraphQL mutation must create a SyncAction after the DB write and return its ID as `lastSyncId`:

```typescript
// In any resolver mutation
const entity = await ctx.services.issue.create(ctx.orgId, ctx.userId, input);
const sync = await ctx.services.sync.createSyncAction(
  ctx.orgId,
  'I',          // I=Insert, U=Update, D=Delete, A=Archive
  'Issue',      // modelName — matches what SyncManager routes in applyActions
  entity.id,
  entity,       // full entity snapshot — may include Prisma relations (labelAssignments etc.)
);
return { issue: entity, lastSyncId: sync.id.toString(), success: true };
```

`createSyncAction` writes to the `sync_actions` table then publishes to Redis `sync:<orgId>`. The WebSocket server subscribes to this channel and broadcasts to all connected org clients.

**Note:** The `data` column stores the full Prisma return value, which may include relation fields (e.g., `labelAssignments` on Issue). The client's `applySyncAction` must handle this gracefully — `IssueStore` extracts `labelIds` from `labelAssignments` if present.

---

## 20. Search Pattern (Sprint 9-10)

### Server: SearchService

`SearchService` is the single place for all text search. It lives at `src/server/services/search.service.ts` and is exposed via the `searchIssues` GraphQL query.

Strategy:

1. **Identifier pattern** (`ENG-123`): instant lookup via the `identifier` index — no FTS needed.
2. **Free-text**: raw SQL using PostgreSQL's GIN full-text index. Only IDs are fetched from raw SQL (to avoid snake_case mapping); a follow-up `findMany` retrieves typed `Issue` rows. Rank order from the raw query is restored after `findMany`.

```typescript
// Identifier lookup — hits the index directly
const issue = await prisma.issue.findFirst({ where: { identifier: 'ENG-1', ... } });

// Full-text: get ranked IDs, then hydrate
const rows = await prisma.$queryRaw<Array<{ id: string }>>(
  Prisma.sql`SELECT id FROM issues WHERE ... @@ plainto_tsquery(...) ORDER BY ts_rank(...) LIMIT ${first}`
);
const ids = rows.map(r => r.id);
const issues = await prisma.issue.findMany({ where: { id: { in: ids } } });
// Re-sort by rank order
```

The GIN index is added via `prisma/migrations/20260407000000_add_fulltext_search/migration.sql` (raw SQL, not manageable by Prisma schema).

### Client: Local fuzzy search

For instant local search (titles and identifiers), use `IssueStore.search(query)` which delegates to `fuzzySearch()` in `src/lib/fuzzy-search.ts`. This runs synchronously against the MobX pool — no network round-trip.

```typescript
// In a component
const results = issueStore.search(query, 20);
```

The fuzzy algorithm scores based on subsequence matching with run-length bonuses. Scores are in [0, 1]; items scoring 0 are excluded. Results are sorted by descending score.

---

## 21. Command Palette Pattern (Sprint 9-10)

The command palette is controlled by `UIStore.commandPaletteOpen`. The `WorkspaceClient` component renders it at the workspace layout level and registers the `Cmd+K` / `Ctrl+K` global shortcut.

```
<StoreProvider>
  <SyncProvider>
    <WorkspaceClient>          ← registers Cmd+K, renders CommandPalette
      <AppShell />
    </WorkspaceClient>
  </SyncProvider>
</StoreProvider>
```

**Opening:** `uiStore.openCommandPalette()` / `uiStore.toggleCommandPalette()`

**Layers:**

- Layer 0: Search across recent issues (empty query) or fuzzy-matched issues + actions (non-empty query)
- Layer 1 (sub-menu): Set status / assignee / priority / label for a selected issue

**Navigation:** Arrow keys + Enter within the palette; Escape goes back one layer or closes.

---

## 22. Keyboard Shortcut Pattern (Sprint 9-10)

Two hook variants in `src/hooks/use-hotkeys.ts`:

### `useHotkeys(key, handler, options?, deps?)`

Standard single-key or modifier+key shortcut:

```typescript
// Global — fires even from inputs (e.g., Cmd+K for command palette)
useHotkeys('meta+k', () => uiStore.toggleCommandPalette(), { allowInInput: true });

// Conditional — only active when an issue is selected
useHotkeys('s', () => setOpenProperty('status'), { enabled: !!selectedId });
```

Options:

- `allowInInput` (default: `false`) — set `true` for system-level shortcuts
- `enabled` (default: `true`) — set to a boolean condition to gate the shortcut

### `useChord(firstKey, secondKey, handler, deps?)`

Two-key sequential chords (e.g., `G` then `I`). The second key must be pressed within 1 second. Both keys are single characters; modifier keys during the chord cancel it.

```typescript
useChord('g', 'i', () => router.push(`/${workspace}/my-issues`));
useChord('g', 'n', () => router.push(`/${workspace}/inbox`));
```

### Property popover shortcuts

Pressing `S`/`A`/`P`/`L`/`D` when an issue is selected opens the corresponding inline property selector on that row. This is implemented via the `openProperty: OpenProperty` prop on `IssueRow`. Each property select accepts `forceOpen?: boolean` / `onClose?: () => void` to support external open control.

```typescript
// In the team page
useHotkeys('s', () => setOpenProperty('status'), { enabled: !!selectedId });

// Passed to IssueListView → IssueRow → StatusSelect
<StatusSelect forceOpen={openProperty === 'status'} onClose={() => setOpenProperty(null)} />
```

---

## 23. Theme System Pattern (Sprint 11-12)

Theme is managed by `next-themes` (`ThemeProvider` wraps the root layout) with three modes: `light`, `dark`, and `system`.

```typescript
// src/hooks/use-theme.ts — typed wrapper around next-themes
import { useTheme } from '@/hooks/use-theme';

const { theme, setTheme, resolvedTheme } = useTheme();
// theme: 'light' | 'dark' | 'system'
// resolvedTheme: 'light' | 'dark' (the actual applied theme)
setTheme('dark');
```

`ThemeProvider` lives in `src/app/layout.tsx` with `attribute="class"` so `next-themes` toggles the `.dark` class on `<html>`. All shadcn/Tailwind dark-mode utilities (`dark:bg-*`, `dark:text-*`) work automatically.

**Rules:**

- Never hardcode colours as hex strings in components — always use Tailwind semantic tokens (`bg-zinc-50`, `dark:bg-zinc-950`, etc.) or CSS custom properties from `globals.css`
- The `ThemeToggle` component (three-way Light / Dark / System) is rendered in the sidebar footer
- Add `suppressHydrationWarning` to `<html>` to suppress the inevitable SSR mismatch from the theme class injection

---

## 24. Toast Notification Pattern (Sprint 11-12)

Use the helpers in `src/lib/toast.ts` — never import `sonner` directly in components. This keeps the call-site clean and gives us a single place to change options (duration, position, etc.) app-wide.

```typescript
import { toast } from '@/lib/toast';

toast.success('Issue created');
toast.error('Failed to update issue. Retrying…');
toast.info('You are offline. Changes will sync when reconnected.');
toast.warning('Due date is in the past.');
```

`Toaster` is registered once in `src/app/layout.tsx` with `richColors`, `closeButton`, and `position="bottom-right"`.

**Standard messages:**

| Event            | Call                                                     |
| ---------------- | -------------------------------------------------------- |
| Issue created    | `toast.success('Issue created')`                         |
| Issue updated    | `toast.success('Issue updated')`                         |
| Issue archived   | `toast.info('Issue archived')`                           |
| Mutation failed  | `toast.error('Failed to save. Retrying…')`               |
| Offline detected | `toast.info('Offline — changes will sync on reconnect')` |
| Back online      | `toast.success('Back online')`                           |

---

## 25. Skeleton / Loading State Pattern (Sprint 11-12)

Show skeleton shimmer components during the initial bootstrap sync (before IndexedDB + MobX stores are populated). Never show a blank screen or a spinner.

```typescript
// src/components/ui/skeleton.tsx — available exports
import { IssueListSkeleton, IssueSkeleton, SidebarSkeleton, DetailPanelSkeleton } from '@/components/ui/skeleton';

// In SyncProvider or page components:
if (!bootstrapComplete) return <IssueListSkeleton count={10} />;
```

**Entity → Skeleton mapping:**

| Context                      | Component                         |
| ---------------------------- | --------------------------------- |
| Issue list (bootstrapping)   | `<IssueListSkeleton count={8} />` |
| Single issue row placeholder | `<IssueSkeleton />`               |
| Sidebar during hydration     | `<SidebarSkeleton />`             |
| Detail panel (lazy loading)  | `<DetailPanelSkeleton />`         |

The `Skeleton` base component uses `animate-pulse bg-zinc-200 dark:bg-zinc-800` — no external library needed.

---

## 26. Error Boundary Pattern (Sprint 11-12)

Wrap each major UI section in an `ErrorBoundary` so one failure doesn't blank the whole page.

```typescript
import { ErrorBoundary, SectionError } from '@/components/error-boundary';

// Default fallback (retry button + generic message)
<ErrorBoundary>
  <IssueListView />
</ErrorBoundary>

// Custom fallback
<ErrorBoundary fallback={<SectionError message="Could not load issues." onRetry={refetch} />}>
  <IssueListView />
</ErrorBoundary>
```

`ErrorBoundary` is a class component (required by React's error boundary API). It logs to `console.error` in development; in production this is where `Sentry.captureException` would be called.

**Placement rules:**

- Wrap `IssueListView` on every team/my-issues page
- Wrap `IssueDetailPanel` separately (so panel crash doesn't take down the list)
- Do NOT wrap individual rows — too granular

---

## 27. Code Splitting Pattern (Sprint 11-12)

Large components that are not needed on initial render should be lazy-loaded with `React.lazy` + `Suspense`.

```typescript
// Pattern used for CommandPalette in WorkspaceClient:
const CommandPalette = lazy(() =>
  import('@/components/command-palette/command-palette').then(m => ({
    default: m.CommandPalette,
  })),
);

// Only mount when open — avoids loading the chunk until first Cmd+K
{uiStore.commandPaletteOpen && (
  <Suspense>
    <CommandPalette recentItems={recentItems} />
  </Suspense>
)}
```

For the `IssueDetailPanel`, use the `LazyIssueDetailPanel` wrapper from `src/components/issues/lazy-issue-detail-panel.tsx` instead of importing `IssueDetailPanel` directly. It handles the `Suspense` boundary with `<DetailPanelSkeleton />` as the fallback.

**Lazy-loaded chunks (as of Sprint 11-12):**

| Chunk                | Trigger             |
| -------------------- | ------------------- |
| `command-palette`    | First `Cmd+K` press |
| `issue-detail-panel` | First issue opened  |

---

## 28. Rate Limiting Pattern (Sprint 11-12)

Two layers defend the GraphQL endpoint:

1. **Hard caps via GraphQL validation rules** (rejected before resolvers run):
   - Query depth ≤ 10 (`graphql-depth-limit`)
   - Query complexity ≤ 1000 (`graphql-query-complexity`, `simpleEstimator` — 1 point per field)
2. **Per-user Redis fixed-window budget** — 5,000 requests / hour and 250,000 complexity points / hour. Logic lives in `src/server/middleware/rate-limit.ts` and is applied in `src/app/api/graphql/route.ts`.

Unauthenticated auth mutations (`emailLogin`, `emailVerify`) have dedicated per-email + per-IP limits in the same module.

**Response headers** (present on every authenticated GraphQL response):

```
X-RateLimit-Requests-Limit: 5000
X-RateLimit-Requests-Remaining: 4999
X-RateLimit-Requests-Reset: 1712534400   ← unix timestamp
X-Complexity: 12
X-RateLimit-Complexity-Limit: 250000
X-RateLimit-Complexity-Remaining: 249988
```

**Exceeded response:** HTTP 400, `extensions.code = 'RATELIMITED'`.

The bucket key is `rl:<userId>:<window>` where `<window>` is `floor(unixSeconds / 3600)` — changes every hour, auto-expiring via Redis TTL.

---

## 29. Structured Logging Pattern (Sprint 11-12)

All server-side logging uses the `logger` singleton from `src/server/lib/logger.ts` (backed by `pino`). Never use `console.log` in server code.

```typescript
import { childLogger, logger } from '@/server/lib/logger';

// Module-level log
logger.info({ userId, orgId }, 'User authenticated');
logger.error({ err, query: req.url }, 'GraphQL handler failed');

// Request-scoped child (pre-bind userId/orgId once, then use throughout)
const reqLog = childLogger({ orgId: ctx.orgId, userId: ctx.userId });
reqLog.info({ issueId }, 'Issue created');
```

**Log levels:**

- `trace` — fine-grained debugging (disabled in production)
- `debug` — dev-useful info (disabled in production)
- `info` — normal operations (auth events, mutations, sync actions)
- `warn` — rate limit exceeded, retries, degraded states
- `error` — unhandled errors, service failures

Override with `LOG_LEVEL` env var. Pretty-print in dev with `LOG_PRETTY=1`.

---

## 30. Sidebar Collapse Pattern (Sprint 11-12)

`UIStore.sidebarCollapsed` is the single source of truth for sidebar state. Toggle via `uiStore.toggleSidebarCollapsed()`.

```typescript
// Keyboard shortcut registered in WorkspaceClient
useHotkeys('meta+b', () => uiStore.toggleSidebarCollapsed());
useHotkeys('ctrl+b', () => uiStore.toggleSidebarCollapsed());

// AppShell reads collapsed state (observer pattern)
const AppShell = observer(function AppShell({ children }) {
  const { uiStore } = useStore();
  return (
    <div className="flex h-screen">
      <Sidebar collapsed={uiStore.sidebarCollapsed} onToggle={() => uiStore.toggleSidebarCollapsed()} />
      <main>{children}</main>
    </div>
  );
});
```

The `Sidebar` component uses `transition-[width]` for smooth animation: `w-56` (expanded) → `w-12` (collapsed). In collapsed mode, nav items show icons only and hide their text labels; the theme toggle is hidden. The `<aside>` element carries `data-collapsed="true|false"` for deterministic E2E assertions.

---

## 31. E2E Testing Pattern (Sprint 11-12)

E2E tests use **Playwright** and live in `tests/e2e/`. Run with `yarn test:e2e`.

```
tests/
├── e2e/
│   ├── auth.spec.ts           # Login → verify → workspace
│   ├── command-palette.spec.ts
│   ├── issue-crud.spec.ts     # Create → edit → archive
│   ├── issue-list.spec.ts     # Group, collapse, J/K navigation
│   ├── keyboard.spec.ts       # Global shortcuts
│   ├── offline.spec.ts        # Optimistic offline + sync-on-reconnect
│   ├── sync.spec.ts           # Cross-tab real-time sync
│   └── team-crud.spec.ts
└── fixtures/
    ├── auth.ts                # loginAs(page, email) helper
    └── seed.ts                # Shared test data constants
```

**Auth in tests:** Use `loginAs(page, email)` from `tests/fixtures/auth.ts`. It drives the email → verify flow. Set `TEST_AUTH_CODE` env var to a known bypass code when running against a test seed.

**Configuration:** `playwright.config.ts` at project root. Starts `yarn dev` automatically before running tests (`webServer`). In CI, runs only Chromium to save time (`workers: 1`).

---

## 32. Adding a New Sync Entity (Sprint 13-14)

When adding a new entity to the real-time sync pipeline, touch five files in order. `ProjectUpdate` (Sprint 13-14) is the canonical example.

### Step 1 — Client type (`src/lib/db.ts`)

Add a `DB*` interface that mirrors the Prisma model with JS-friendly types (Date → string, BigInt → string):

```typescript
export interface DBProjectUpdate {
  id: string;
  projectId: string;
  userId: string;
  body: string;
  health?: string | null;
  editedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}
```

Add a Dexie version bump with the new table:

```typescript
// Bump the version — NEVER modify a previous version block
this.version(3).stores({
  ...allPreviousTableSchemas,
  projectUpdates: 'id, projectId, userId',
});
```

And add a typed table property to `AppDatabase`:

```typescript
projectUpdates!: Table<DBProjectUpdate, string>;
```

### Step 2 — MobX store

Add an `updatePool` observable map and the three standard methods to the relevant store:

```typescript
updatePool = new Map<string, DBProjectUpdate>();

// makeObservable: add applyUpdateSyncAction, updatePool, upsertUpdates

upsertUpdates(updates: DBProjectUpdate[]) {
  for (const update of updates) this.updatePool.set(update.id, update);
}

getUpdates(projectId: string): DBProjectUpdate[] {
  return Array.from(this.updatePool.values())
    .filter(u => u.projectId === projectId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));  // ISO strings sort lexicographically
}

applyUpdateSyncAction(actionType: string, id: string, data: DBProjectUpdate | null) {
  if (actionType === 'I' || actionType === 'U' || actionType === 'A') {
    if (data) this.updatePool.set(id, data);
  } else if (actionType === 'D') {
    this.updatePool.delete(id);
  }
}
```

> **ISO date sort:** For `createdAt` fields stored as ISO 8601 strings, `b.createdAt.localeCompare(a.createdAt)` is equivalent to comparing `Date.getTime()` values and avoids the `new Date()` allocation.

> **Architecture boundary:** `SyncActionType` lives in `src/server/services/sync.service.ts` (server-only). Never import it in store or client code — accept `string` instead and check `=== 'I'` etc.

### Step 3 — Bootstrap endpoint (`src/app/api/sync/bootstrap/route.ts`)

Add the new entity to the `getBootstrapData` call and emit its lines in the streaming response:

```typescript
for (const update of data.projectUpdates) {
  lines.push(`ProjectUpdate=${JSON.stringify(update)}`);
}
```

### Step 4 — SyncManager (`src/lib/sync-manager.ts`)

Three places:

1. **`loadFromIndexedDB`** — hydrate the store from Dexie on startup:

   ```typescript
   const projectUpdates = await db.projectUpdates.toArray();
   projectStore.upsertUpdates(projectUpdates);
   ```

2. **`fullBootstrap`** — save bootstrap data to Dexie atomically, then populate stores:

   ```typescript
   // In the Dexie transaction
   await db.projectUpdates.clear();
   await db.projectUpdates.bulkPut(batches.projectUpdates);
   // After the transaction
   projectStore.upsertUpdates(batches.projectUpdates);
   ```

3. **`applyActions`** — route the model name in the switch statement:

   ```typescript
   case 'ProjectUpdate':
     db.projectUpdates  // for Dexie upsert/delete
     projectStore.applyUpdateSyncAction(action, id, data as DBProjectUpdate | null);
     break;
   ```

### Step 5 — Bootstrap service (`src/server/services/sync.service.ts`)

Add the Prisma query to `getBootstrapData`'s `Promise.all`:

```typescript
this.prisma.projectUpdate.findMany({
  orderBy: { createdAt: 'desc' },
  take: 500,  // hard cap — add TODO comment if unbounded growth is a risk
  where: { project: { archivedAt: null, organizationId: orgId, trashed: false } },
}),
```

Add to destructuring and the return object.

### Store unit tests

Pure store tests (no Prisma mock needed) go alongside the store file. Follow `src/stores/project-store.test.ts` as the reference: test `upsertMany`, `getUpdates` (filter + sort), and `applyUpdateSyncAction` (all four action types + null data guard).

---

## 33. Board View / Drag-and-Drop Pattern (Sprint 17-18)

The board view uses `@dnd-kit` for drag-and-drop. Key conventions:

- `DndContext` wraps the entire board; `SortableContext` wraps each column
- Drag end handler reads `active.id` (issue ID) and `over.id` (target column / state ID)
- On drop: immediately apply optimistic MobX update (`issueStore.updateIssue()`), then enqueue the `issueUpdate` mutation via `TransactionQueue`
- State columns are derived from `workflowStateStore.getTeamStates(teamId)` — never hardcoded
- Reference: `src/components/issues/board-view.tsx`

---

## 34. Filter Builder Pattern (Sprint 19-20)

Filters are stored as `FilterData` objects (`src/types/issues.ts`) and applied client-side via `issueStore.getFilteredIssues()`.

```typescript
// FilterData shape — each key is optional; all present filters are ANDed
interface FilterData {
  stateIds?: string[];
  assigneeIds?: string[];
  labelIds?: string[];
  priorities?: number[];
  projectIds?: string[];
  cycleIds?: string[];
  creatorIds?: string[];
  estimate?: { gte?: number; lte?: number };
  dueDate?: { gte?: string; lte?: string };
}
```

- `FilterBuilder` component (`src/components/issues/filter-builder.tsx`) renders filter pills and handles add/remove/change
- Saving a filter creates a `CustomView` record via GraphQL (`customViewCreate` mutation) — `CustomViewStore` holds the pool
- Active filters are kept in URL params (`?filter=<base64-encoded-json>`) so deep-linking works
- Server-side search (`searchIssues`) accepts the same filter shape and applies it as Prisma `where` clauses

---

## 35. Notification Pattern (Sprint 21-22)

Notifications are created server-side in service methods; the client receives them via WebSocket sync.

```typescript
// Trigger notification in a service method
await ctx.services.notification.create({
  orgId,
  userId: targetUserId,
  type: 'issueAssignment',
  issueId,
  actorId: ctx.userId,
});
```

- `NotificationStore` holds the pool; `NotificationInbox` component reads from it
- Unread count badge: `notificationStore.unreadCount` (computed from `readAt === null`)
- "Mark all read" calls `notificationMarkAllRead` mutation → updates all `readAt` fields → `SyncAction` propagates to store
- Reference: `src/server/services/notification.service.ts`, `src/stores/notification-store.ts`, `src/components/notifications/notification-inbox.tsx`

---

## 36. Comment Thread Pattern (Sprint 29-30)

Comments are fetched on demand via GraphQL (not part of bootstrap), stored in component-local state.

```typescript
// Load comments for an issue
const { data } = await graphql(ISSUE_COMMENTS_QUERY, { issueId });
```

- `CommentThread` component (`src/components/issues/comment-thread.tsx`) handles threading via `parentId`
- Reactions use the `commentReactionToggle` mutation — the component maintains optimistic local state
- Resolution: `commentResolve` / `commentUnresolve` mutations; resolved comments are visually collapsed
- Rich text in comments uses the same `TipTapEditor` component as issue descriptions
- @mentions in comments trigger `issueMention` notifications via `NotificationService`
- Reference: `src/components/issues/comment-thread.tsx`, `src/server/services/comment.service.ts`

---

## 37. TipTap Rich Text Editor Pattern (Sprint 27-28)

The `TipTapEditor` component (`src/components/editor/tiptap-editor.tsx`) is used for issue descriptions and comments.

```tsx
<TipTapEditor
  content={issue.description}
  onChange={(json) => updateIssue({ description: JSON.stringify(json) })}
  mentionUsers={teamMembers}  // passed for @mention autocomplete
  editable={canEdit}
/>
```

- Extensions: StarterKit, Highlight, TaskList, Table, CodeBlockLowlight, Image, Mention, `SlashCommands`, `MermaidNode`, `EmbedNode` (YouTube / Loom / generic), `DetailsNode` (collapsible sections)
- `mentionUsers` prop feeds the `MentionList` suggestion component
- Image upload: toolbar button → `POST /api/upload` → `File` row → URL inserted as an image node. File attachments use the same flow via `file-attachments.tsx`.
- Slash commands are wired via the `SlashCommands` extension; the popup is driven by `slash-command-list.tsx` (dynamic-imported so it stays out of the critical bundle)
- The `Document` editor (`/documents/[id]`) reuses the same extension set so server-side markdown rendering is identical
- Still planned: @mentions for issues / projects (users only today), image drag-and-drop, YJS / Hocuspocus collab
- Reference: `src/components/editor/tiptap-editor.tsx`, `src/components/editor/slash-commands.ts`, `src/components/editor/embed-node.tsx`, `src/components/editor/mermaid-node.tsx`
