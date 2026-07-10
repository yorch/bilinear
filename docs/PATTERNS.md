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

Route protection is enforced **per page**, not by edge middleware (there is no `src/middleware.ts`). Server components read the `access_token` cookie via `next/headers` and `redirect('/login')` when it is missing or fails verification — see `src/app/page.tsx`:

```typescript
const token = (await cookies()).get('access_token')?.value;
if (!token) redirect('/login');
try {
  await verifyAccessToken(token); // never falls back to an empty JWT secret
} catch {
  redirect('/login'); // token invalid/expired
}
```

The `(auth)` route group runs no such check, so its routes are public by construction: `/login`, `/verify`, `/onboarding`, and the OAuth callbacks `/auth/google/callback` and `/auth/github/callback` (each exchanges its `code` + `state` and installs session cookies before redirecting to `/`).

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
- Use `useMemo` with `store.pool.size` as a dependency — the Map itself is stable; `pool.size` changes when entries are added/removed. **Caveat**: `optimisticUpdate(id, patch)` does `pool.set(id, {...existing, ...patch})` which keeps `pool.size` constant, so a `useMemo` whose result depends on a filter over per-entry fields (`stateId`, `priority`, `assigneeId`, …) will be **stale** after an optimistic edit. For those selectors, drop the `useMemo` and compute inline under the wrapping `observer` so MobX tracks the per-entry reads. The triage queue (`/team/[key]/triage/page.tsx`) is one such selector.
- Use `useStore()` to access the `RootStore` from context — never import `getRootStore()` directly in components
- `TransactionQueue` instances share a singleton in-memory FIFO backed by an IndexedDB `pendingTransactions` table. The `new TransactionQueue()` per component mount with `useMemo(() => new TransactionQueue(), [])` convention still holds — every instance enqueues into the shared queue. Pending transactions persist across page reloads. Each persisted row is stamped with the `orgId`/`userId` of the session that enqueued it; `SyncProvider` calls `TransactionQueue.setActiveSession({orgId, userId})` from the JWT claims and `TransactionQueue.hydrate(session)` filters to that session — rows from other users/orgs are deleted instead of replayed (so a sign-out + sign-in on the same browser never replays the previous user's mutations under the new user's auth cookies). Callbacks (`onSuccess`/`onError`) live in-memory only and don't survive reload — rehydrated transactions fire fire-and-forget and reconcile via the WebSocket SyncAction stream.
- The frontend still does **not** use Apollo Client — mutations are plain template strings passed to `txQueue.enqueue()`
- Shared frontend types (`WorkflowState`, `IssueUser`, `IssueLabel`, `IssueBase`, `IssueDetail`) live in `src/types/issues.ts`
- DB entity types (`DBIssue`, `DBTeam`, etc.) live in `src/lib/db.ts` — these are the types stored in IndexedDB and MobX pools

---

> **§13 is intentionally absent** — the numbering jumped from §12 to §14
> when an early draft section was removed before it was written. The gap is
> cosmetic; no pattern is missing.

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

```text
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

```text
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

**Store tests** instantiate the store directly — MobX stores are pure in-memory
pools with no DB/network dependency, so no mocks are needed:

```typescript
const store = new IssueStore();
store.upsertMany([makeIssue({ id: '1' })]);
store.applySyncAction('D', '1', null);
expect(store.findById('1')).toBeNull();
```

Cover the computed getters (archived/trashed filtering, sort order), the
`findBy*` lookups, and `applySyncAction` for each `I`/`U`/`A`/`D` branch —
including any cascade (e.g. `CustomFieldStore` drops a definition's values on
`D`, `InitiativeStore` drops project links).

**Pure client-lib tests** (`src/lib/*.test.ts`) need no harness at all. Pin the
clock with `vi.useFakeTimers()` + `vi.setSystemTime(...)` for anything that
reads `new Date()` (e.g. `formatRelativeTime`, `getDueDateColor`).

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

```tsx
<StoreProvider>          ← creates RootStore singleton, provides via React context
  <SyncProvider>         ← bootstraps data, starts WsClient, teardown on unmount
    <AppShell />
  </SyncProvider>
</StoreProvider>
```

`SyncProvider` on mount:

1. Fetches a session resolution from `GET /api/auth/ws-ticket` (server reads the httpOnly access cookie, returns `{ ticket, userId, orgId }`). The `ticket` is consumed only by `SyncProvider` to confirm the session is live — it's not threaded down into `SyncManager` since `WsClient` re-fetches its own fresh ticket on every (re)connect.
2. Calls `userStore.setCurrentUserId(userId)` so `currentUser` resolves everywhere
3. Creates `SyncManager` and `WsClient`
4. Calls `syncManager.start(orgId)` which runs:
   - Compare cached vs active `orgId`; wipe IndexedDB if changed
   - Load from IndexedDB → if cached, delta sync; otherwise full bootstrap
   - `wsClient.connect()` — WsClient fetches a fresh `ws_ticket` from `/api/auth/ws-ticket` and opens the socket. It does the same on every reconnect, so the 60s ticket lifetime is bounded per-connection and transient downtime past that still recovers automatically.
   - Register `online`/`offline` event listeners

On unmount, `syncManager.stop()` disconnects WebSocket and removes event listeners.

**WebSocket auth (ws-ticket flow):** Browsers cannot set custom headers on WebSocket connections, AND we never want the long-lived access JWT readable by JavaScript. So `/api/auth/ws-ticket` issues a separate 60s ticket whose `type` claim is `ws_ticket` — it carries `userId` / `orgId` but is verified server-side via `verifyWsTicket` and rejected by `verifyAccessToken`. The ticket is passed in the query string of the WS upgrade URL. `WsClient` re-fetches a fresh ticket on every reconnect, so transient downtime past the 60s lifetime still recovers automatically.

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

```tsx
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

```text
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

All server-side logging uses the `logger` singleton from `src/server/lib/logger.ts` (backed by `pino`). Never use `console.log` in server code. Prefer a module-bound `childLogger({ module })` over the raw `logger` so lines can be filtered by module.

```typescript
import { childLogger, logger } from '@/server/lib/logger';

// Module-bound child — the convention for every server file
const log = childLogger({ module: 'resolver/issue' });
log.info({ issueId }, 'Issue created');
log.error({ err }, 'webhook dispatch failed');
```

**Request correlation (AsyncLocalStorage).** A pino `mixin` merges a per-request store (`requestId`, `route`, and `orgId`/`userId` once known) onto **every** log line emitted during the request — including deep in services — so no logger needs to be threaded through call sites. `/api/graphql` wraps each request inline via `runWithRequestContext(...)`. Other logging API routes (`sync/*`, `integrations/*`, `auth/saml/*`) wrap their exported handler with `withRequestContext('<route>', handler)` from `@/server/lib/request-context` and call `bindRequestContext({ orgId, userId })` once auth resolves. To add request-scoped fields anywhere, `runWithRequestContext`/`bindRequestContext` shallow-merge into the active scope.

**Sentry + redaction.** A `hooks.logMethod` hook forwards any `error`/`fatal` log that carries an `Error` (as `err` or the first arg) to `Sentry.captureException`. Because it's a pino hook, child loggers inherit it — `.child()` can't bypass capture. `redact` scrubs credential-ish paths and PII (`password`, `*.token`, `authorization`, `cookie`, `email`, …) before serialization as defense-in-depth. It can't catch a secret embedded inside a value (e.g. a token in a URL string), so still keep those out of logs at the call site — key off `userId`/`orgId` instead.

**GraphQL access/error logs.** `observabilityPlugin` in the route emits one structured line per operation (`operationName`, `operationType`, `durationMs`, `status`, `errorCount`) and logs server-side faults at `error` (client-error codes like `BAD_USER_INPUT`/`NOT_FOUND` are skipped). Successful requests — and requests that fail with only client-error codes — are sampled by `LOG_HTTP_SAMPLE_RATE` (0..1, default 1); server-side faults and slow (≥1s) requests bypass sampling and are always logged.

**Client logging.** Client code never imports the pino logger. Use `createClientLogger(scope)` from `src/lib/logger.ts` — it console-logs in dev, forwards `error` to Sentry as events, and records `warn` as breadcrumbs (so high-frequency benign warnings don't flood Sentry) in prod. Error boundaries report via the shared `useReportRenderError` hook, since Next.js swallows boundary errors before Sentry's global handlers see them.

**Log levels:**

- `trace` — fine-grained debugging (disabled in production)
- `debug` — dev-useful info (disabled in production)
- `info` — normal operations (auth events, mutations, sync actions)
- `warn` — rate limit exceeded, retries, degraded states
- `error` — unhandled errors, service failures

Override with `LOG_LEVEL` env var. Pretty-print in dev with `LOG_PRETTY=1`. `pino`/`pino-pretty` are in `serverExternalPackages` (next.config.ts) so the pretty transport's worker thread resolves correctly instead of being bundled.

---

## 30. Sidebar Collapse Pattern (Sprint 11-12)

`UIStore.sidebarCollapsed` is the single source of truth for sidebar state. Toggle via `uiStore.toggleSidebarCollapsed()`.

```tsx
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

```text
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

> **Opt-out exception:** admin-only entities (e.g. `Webhook`, `WebhookDelivery`) are deliberately *not* synced. Only org admins ever read them, so mirroring rows into every member's IndexedDB would leak signing secrets and waste bandwidth. Instead, the settings page fetches via GraphQL on demand. See PATTERNS §40 for the webhook flow.

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

**High-level helpers** (use these instead of calling `create()` directly):

| Method | Notification type | Email sent |
|---|---|---|
| `createForIssueAssignment(orgId, issueId, assigneeId, actorId)` | `ISSUE_ASSIGNED` | Yes — skipped if `assigneeId === actorId` |
| `createForStatusChange(orgId, issueId, actorId, oldStatus, newStatus)` | `ISSUE_STATUS_CHANGED` | Yes — fan-out to all subscribers except actor |
| `createForMention(orgId, issueId, mentionedUserId, actorId, excerpt?)` | `ISSUE_MENTIONED` | Yes — skipped if `mentionedUserId === actorId` |
| `notifyCommentSubscribers(orgId, issueId, actorId, commentId, excerpt?)` | `ISSUE_COMMENTED` | Yes — fan-out to all subscribers except actor |

**Email opt-out.** `User.emailNotificationsEnabled` (boolean, default `true`) gates all outgoing notification emails. `resolveEmailContext()` checks the flag before calling any sender — no email is ever sent to an opted-out user. Users toggle the preference via `userUpdateNotificationPreferences` mutation.

**Fire-and-forget.** Email sends are always `void ... .catch(log.error)` — they never block the mutation response. Failures are logged but do not surface to callers.

- Reference: `src/server/services/notification.service.ts`, `src/server/lib/email.ts`, `src/stores/notification-store.ts`, `src/components/notifications/notification-inbox.tsx`

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

---

## 38. Triage Workflow Pattern (2026-05-05)

Triage-enabled teams have a `triage`-type workflow state seeded at team creation (see `TeamService.seedDefaultStates`). New issues created on a triage-enabled team without an explicit `stateId` are auto-routed there (see `IssueService.create`).

```typescript
// IssueService.create — triage routing
let triageStateId: string | null = null;
if (!input.stateId && team.triageEnabled) {
  const triageState = await tx.workflowState.findFirst({
    where: { archivedAt: null, teamId: input.teamId, type: 'triage' },
  });
  triageStateId = triageState?.id ?? null;
}
const stateId = input.stateId ?? triageStateId ?? team.defaultIssueStateId;
const enteringTriage = stateId === triageStateId;
// ...stamp `startedTriageAt` if enteringTriage.
```

The `TriageService` exposes four mutations: `accept`, `decline`, `markDuplicate`, `snooze`. All four use **atomic CAS** via `updateMany({ where: { id, stateId: triageState.id } })` so two concurrent operators can't both succeed and emit conflicting SyncActions.

| Action          | Effect                                                                                |
| --------------- | ------------------------------------------------------------------------------------- |
| `accept`        | Move to a target workflow state (must belong to the same team), stamp `triagedAt`     |
| `decline`       | Move to the team's first `canceled` state, stamp `canceledAt` + `triagedAt`           |
| `markDuplicate` | Create a `duplicate` IssueRelation + cancel (idempotent via `createMany skipDuplicates`) |
| `snooze`        | Set `snoozedUntilAt`; queue filter excludes snoozed-and-future issues                 |

**UI optimistic updates.** The triage page (`/team/[key]/triage`) snapshots the issue, applies the optimistic state change, calls the mutation, and rolls back on error (with a `toast` from `@/lib/toast`). Decline/snooze hide the row by setting a synthetic `snoozedUntilAt` until the WS sync replaces it with the real cancel.

Reference: `src/server/services/triage.service.ts`, `src/server/graphql/resolvers/triage.ts`, `src/app/(workspace)/[workspace]/team/[key]/triage/page.tsx`.

---

## 39. Initiative Roll-up Pattern (2026-05-05)

`Initiative` is a top-level strategic object that links m:n to `Project`. `Initiative.progress` is a cached float (0..1) computed as the mean progress of associated non-archived/non-trashed projects.

**Recompute fan-out.** Project mutations that affect roll-up (`projectArchive`, `projectDelete`, and any `projectUpdate` whose `progress` or `statusType` changed) call `initiative.recomputeProgress(initId)` for every linked initiative AND emit a follow-up `'U' Initiative` SyncAction so collaborators see the new progress in real time.

```typescript
// project.ts resolver — recompute hook
if (existing.progress !== project.progress || existing.statusType !== project.statusType) {
  const initiatives = await ctx.services.initiative.getInitiativesForProject(id);
  for (const init of initiatives) {
    const updated = await ctx.services.initiative.recomputeProgress(init.id);
    if (updated) {
      sync = await ctx.services.sync.createSyncAction(ctx.orgId, 'U', 'Initiative', init.id, updated);
    }
  }
}
```

**Status transitions** clear the *other* lifecycle timestamps so a revert doesn't leave a stale terminal marker:

- `→ planned` clears `startedAt`, `completedAt`, `canceledAt`
- `→ active` stamps `startedAt`, clears `completedAt` + `canceledAt`
- `→ completed` stamps `completedAt`, clears `canceledAt`
- `→ canceled` stamps `canceledAt`, clears `completedAt`

**Two-action emission.** `initiativeAddProject`/`initiativeRemoveProject` emit BOTH an `InitiativeProject` action (link row) and an `Initiative` `'U'` action (recomputed progress) — without the link action other clients see the progress change but no project membership.

Reference: `src/server/services/initiative.service.ts`, `src/server/graphql/resolvers/initiative.ts`, `src/server/graphql/resolvers/project.ts`, `src/stores/initiative-store.ts`.

---

## 40. Webhook Dispatch Pattern (2026-05-05)

Outbound HTTP webhooks live entirely on the server — they're admin-only and not synced to clients. Subscriptions are CRUDed through the GraphQL admin surface; events are dispatched via `WebhookService.dispatchEvent(orgId, event, data, teamId?)` from inside resolvers, AFTER the SyncAction is written so the system-of-record is the truth before the fan-out fires.

```typescript
// issueCreate resolver
const issue = await ctx.services.issue.create(ctx.orgId, ctx.userId, input);
const sync = await ctx.services.sync.createSyncAction(ctx.orgId, 'I', 'Issue', issue.id, issue);
void ctx.services.webhook
  .dispatchEvent(ctx.orgId, 'issue.created', issue, issue.teamId)
  .catch(err => logger.error({ err }, 'webhook dispatch failed: issue.created'));
return { issue, lastSyncId: sync.id.toString(), success: true };
```

**Always `void` the dispatch** — never `await`. A slow subscriber endpoint must not block the mutation response.

**Signing.** HMAC SHA-256 over the JSON body with the per-webhook `signing_secret`. Header: `X-Bilinear-Signature: sha256=<hex>`. Receivers verify with the helper `verifySignature(rawBody, secret, headerValue)` exported from `webhook.service.ts`.

**SSRF protection** is two-layered: `validateUrl` rejects private/loopback hosts at create time (covers decimal/octal/hex IP encodings, IPv4-mapped IPv6, RFC 1918, link-local, `.local`/`.internal` suffixes); `assertSafeUrl` re-resolves the hostname at delivery time to defeat DNS rebinding. Bypass requires explicit `ALLOW_PRIVATE_WEBHOOK_URLS=1` (default-deny in all environments).

**Concurrency-safe retries.** `processDelivery` atomically transitions the row from `pending` to `in_flight` in a single `updateMany`. Two concurrent runners contend on the row; the loser sees `count=0` and bails, so an event is never delivered twice. Crashed-worker recovery is built in: the claim also accepts `in_flight` rows whose stamped `next_attempt_at` deadline has elapsed. Auto-disable (after `consecutive_failures >= 20`) uses an atomic conditional update so a successful delivery cannot be raced into a disabled state.

**Background sweep.** The WS server's `setInterval(processDuePending, 30s)` drains both `pending` and stale `in_flight` rows whose `next_attempt_at <= now()`. Backoff schedule: 30s → 2m → 10m → 30m → 2h, capped at 5 attempts. With multiple WS replicas every replica runs the sweep — the atomic `pending → in_flight` claim keeps deliveries unique, but replicas waste a query/tick contending for the same rows. Add a leader election or `pg_advisory_lock` if the fleet grows.

**Field-level secret guard.** `Webhook.signingSecret` has a field-level resolver that re-checks org admin role; non-admins get `null` even if some future query path returns the row.

Reference: `src/server/services/webhook.service.ts`, `src/server/graphql/resolvers/webhook.ts`, `src/server/ws/index.ts` (retry tick).

---

## 41. GitHub Integration Pattern (2026-05-17)

One GitHub OAuth app per deployment; one integration row per organization (1:1 via `github_integrations.organization_id` unique constraint). The integration stores the user's access token, GitHub login, and the webhook secret the user configures in GitHub settings.

### OAuth Connect Flow

```
GET /api/integrations/github
  → encode { orgId, userId, webhookSecret } as base64url JSON → state param
  → redirect to https://github.com/login/oauth/authorize?...

GET /api/integrations/github/callback?code=...&state=...
  → decode state, call GitHubService.connect(orgId, userId, { code, webhookSecret })
  → exchangeCodeForToken(code) → fetchGitHubUser(accessToken)
  → INSERT github_integrations row
  → redirect to /settings/integrations?connected=1
```

Required env vars: `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`.

### Webhook URL Format

Users configure GitHub to POST to:
```
https://<APP_URL>/api/integrations/github/webhook?org=<organization.urlKey>
```

The `?org=` query param identifies the workspace. The route validates the `X-Hub-Signature-256` HMAC before processing any payload.

### PR Auto-Linking

`handlePullRequestEvent` extracts issue identifiers from the combined string `"${pr.title} ${pr.head.ref}"` using:

```
/\b([A-Z][A-Z0-9]{1,9}-\d+)\b/g   (case-insensitive match on uppercased input)
```

Each matched identifier is resolved to an `Issue` in the org, then a `github_pull_requests` row is upserted (unique on `[integrationId, prNumber, repoFullName, issueId]` — one row per PR+issue pair, so one PR can link to many issues). Handled actions: `opened`, `reopened`, `synchronize`, `closed`.

### PR Auto-Close on Merge

When `action === 'closed'` and `pr.merged === true`, `autoCloseIssuesOnMerge` runs for all linked issues that are **not** already in a `completed` or `canceled` workflow state. Each such issue is transitioned to the team's first `completed`-type workflow state (lowest `position`). This mirrors Linear's "close issue on PR merge" behavior.

### State Representation

| `GitHubPullRequest.state` | Condition |
|---|---|
| `open` | PR is open (including reopened/synchronize) |
| `closed` | PR closed without merge (`pr.merged === false`) |
| `merged` | PR closed with merge (`pr.merged === true`) |

### Frontend

- `PullRequestsSection` component (`src/components/issues/pull-requests-section.tsx`) renders linked PRs inside `IssueDetailPanel` — hidden when there are no PRs.
- Integration settings live at `/settings/integrations` — connect, disconnect, rotate webhook secret.
- State badges: merged (purple), closed (red), open (green/gray draft).

Reference: `src/server/services/github.service.ts`, `src/server/graphql/resolvers/github.ts`, `src/app/api/integrations/github/`, `src/app/(workspace)/[workspace]/settings/integrations/page.tsx`, `src/components/issues/pull-requests-section.tsx`.

## 42. Issue Reaction Pattern (2026-05-18)

Reactions on issues use the same normalized shape as comment reactions
(§2.15 → §2.30 in DATABASE_SCHEMA.md): one row per `(issueId, userId, emoji)`
tuple. The unique constraint plus `upsert` lets the same client tap the
same emoji twice as an idempotent add — useful for racing optimistic UI.

**Service** (`IssueService.addReaction / removeReaction / listReactions`):

- `addReaction` checks the parent issue exists, then `prisma.issueReaction.upsert`
  on the unique tuple with empty `update: {}` — i.e. a no-op on re-add.
- `removeReaction` looks up the row by tuple and hard-deletes by `id`; throws
  `IssueReactionNotFoundError` for callers that race a double-remove.
- `listReactions` returns rows in insertion order with the `user` included
  for the bar's hover label.

**Resolver** (`src/server/graphql/resolvers/issue.ts`) checks org match +
`requireTeamMember`, then emits an `'I'` or `'D'` SyncAction against the
`IssueReaction` model. Note: client stores are NOT yet wired to apply these —
the reaction bar re-fetches on every mutation rather than reading from sync.

**UI**: `IssueReactionBar` (`src/components/issues/issue-reaction-bar.tsx`)
renders chips for each emoji with the per-user "reacted" highlight, plus a
quick-picker popover seeded with 8 common emojis. Slotted under the issue
title in `IssueDetailPanel`.

The legacy `Issue.reaction_data` JSONB column from §2.4 stays unused — the
normalized table gives us per-user lookups (which the JSONB blob can't) and
matches existing comment-reaction tooling.

Reference: `src/server/services/issue.service.ts`, `src/server/graphql/resolvers/issue.ts`, `src/components/issues/issue-reaction-bar.tsx`.

## 43. Initiative Updates Pattern (2026-05-18)

Status reports on initiatives mirror §11 (`ProjectUpdate`) one for one. Each
post stamps a `health` ("onTrack" | "atRisk" | "offTrack") and a TipTap body;
edits set `editedAt` so the timeline can show "(edited)".

**Author-only edit/delete** is enforced in the resolver, not the service:

```ts
const existing = await ctx.services.initiative.findInitiativeUpdateById(id);
if (!existing) { throw NOT_FOUND }
const initiative = await ctx.services.initiative.findById(ctx.orgId, existing.initiativeId);
if (!initiative) { throw NOT_FOUND }  // tenant guard
if (existing.userId !== ctx.userId) { throw FORBIDDEN }
```

**Soft-delete** sets `archivedAt` and emits a **`'D'`** SyncAction with `null`
payload — NOT `'A'`. The ProjectUpdate code path uses the same convention:
`'A'` requires the archived row payload so client stores can flip
`archivedAt` on the cached entry, while `'D'` instructs consumers to drop
the row entirely from the timeline. For a content feed where archive ==
"hide", `'D'` is the right verb.

**UI**: `InitiativeUpdatesSection`
(`src/components/initiatives/initiative-updates-section.tsx`) renders inside
the expanded row on `/initiatives`. Uses fetch-on-mount + refetch-after-mutate
rather than the MobX store path; this is consistent with how reactions
landed (§42) and keeps the feature additive without touching bootstrap /
sync-manager.

Reference: `src/server/services/initiative.service.ts`, `src/server/graphql/resolvers/initiative.ts`, `src/components/initiatives/initiative-updates-section.tsx`.

## 44. Lazy Daily Snapshot Pattern — Project Progress History (2026-05-18)

`Project` has had four JSONB history columns (`completed_issue_count_history`,
`issue_count_history`, `completed_scope_history`, `scope_history`) since the
init migration, all defaulting to `[]` and untouched until this drop. Rather
than wire a writer into every mutation path that might change a project's
completion ratio (issue create/update/archive × every state transition × etc.),
the snapshot is computed lazily **on the read side**.

`ProjectService.recordProgressSnapshotIfStale(projectId)`:

1. Loads the four history arrays.
2. Reads the last entry of `issueCountHistory`. If `last.t === todayUtc`,
   short-circuits and returns the existing arrays — no SQL aggregate, no write.
3. Otherwise runs four parallel aggregates (`count`, `count where completed`,
   `sum(estimate)`, `sum(estimate) where completed`) and appends a new
   `{ t: 'YYYY-MM-DD', v }` entry to each array.
4. Writes the updated arrays back in a single `project.update`.

The GraphQL field `Project.progressHistory: [ProgressHistoryPoint!]!`
calls this from its resolver, then merges the four arrays by date so the
client receives one row per day with all four metrics filled in.

**Trade-offs deliberately taken:**

- **No intra-day refinement.** Once today's entry is stamped (by the first
  `progressHistory` query of the day), the value is fixed until tomorrow.
  Sparkline shows day-resolution trend, not minute-resolution.
- **No cron.** A project that's never opened never accrues history. A nightly
  job that calls `recordProgressSnapshotIfStale` across all projects would
  close that gap — flagged in §6.2 of LINEAR_FEATURE_GAPS as a follow-up.

Reference: `src/server/services/project.service.ts`, `src/server/graphql/resolvers/project.ts`, `src/components/projects/progress-sparkline.tsx`.

## 45. Editor Image Paste Pattern (2026-05-18)

The TipTap editor accepts pasted/dropped image blobs via ProseMirror's
`editorProps.handlePaste` / `handleDrop` hooks. The wrinkle: `/api/uploads`
only serves files whose `File` row is attached to a parent issue/project the
caller can see (`FileService.findByKeyInOrg`). Posting to `/api/upload`
without a parent creates an orphan `File` row whose URL 404s for everyone.

To avoid the orphan trap, the editor accepts two optional props:

```ts
<TipTapEditor
  uploadIssueId={issue.id}    // or
  uploadProjectId={project.id}
/>
```

`insertPastedImage(file, editorRef, ctx)` branches:

- **With parent context**: POST to `/api/upload` as multipart, append
  `issueId` / `projectId` to the form, insert the returned CDN URL.
- **Without parent context**: read the blob as a base64 data URL and embed
  inline (same fallback as the toolbar button, capped at 2 MB).

The upload context is captured in a ref so the paste handler — created once
at editor mount — always sees fresh ids. Currently threaded through
`IssueDetailPanel` description editor and `CommentComposer`; other call
sites (ProjectUpdate / InitiativeUpdate composers) get the inline fallback.

Reference: `src/components/editor/tiptap-editor.tsx`, `src/app/api/upload/route.ts`, `src/server/services/file.service.ts`.

## 46. Sub-Initiative Hierarchy Pattern (2026-05-21, hardened post-review)

`Initiative.parentId` is a self-FK with `ON DELETE SET NULL` — deleting a
parent re-roots its children rather than cascading. Max nesting depth is
five levels, enforced server-side by `InitiativeService.assertParentAccepts
Child(orgId, parentId, childId | null)` which walks the parent chain
counting depth, detecting cycles (would-be ancestor = the child itself),
and rejecting cross-org parents.

```ts
// Both create and update paths run the guard before writing parent_id.
if (input.parentId) {
  await this.assertParentAcceptsChild(orgId, input.parentId, /* childId */ id ?? null);
}
```

**Progress rollup** averages projects AND child initiatives equally:

```ts
const totalCount = eligibleProjects.length + eligibleChildren.length;
const progress = totalCount === 0
  ? 0
  : (sumProjectProgress + sumChildProgress) / totalCount;
```

**Cascade contract.** `recomputeProgressCascade(id)` returns
`{ self, ancestors }` so the caller can emit one SyncAction per updated
row. The original `recomputeProgress(id)` is preserved as a thin alias
that returns only `self` — but it's a footgun for nested chains
because ancestor SyncActions get dropped. Every project / initiative
write path that triggers a recompute now goes through the cascade form
and iterates `[self, ...ancestors]` emitting one `'U' Initiative` per
row. Recursion stops when an ancestor's rolled-up value didn't change
(the `<1e-9` early return), or when the chain runs out, or on a cycle
(visited-set guard against bad data).

```ts
// Resolver pattern after a project change:
const { self, ancestors } = await ctx.services.initiative.recomputeProgressCascade(init.id);
for (const updated of [self, ...ancestors].filter((i): i is Initiative => i !== null)) {
  await ctx.services.sync.createSyncAction(ctx.orgId, 'U', 'Initiative', updated.id, updated);
}
```

Reference: `src/server/services/initiative.service.ts:recomputeProgressCascade`,
`src/server/graphql/resolvers/project.ts`,
`src/server/graphql/resolvers/initiative.ts`, DATABASE_SCHEMA.md §2.32.

## 47. Sidebar Favorites Pattern (2026-05-21)

A user's pinned entities live in `favorites` keyed by
`(userId, organizationId, entityType, entityId)` with a unique constraint
on `(userId, entityType, entityId)`. Re-favoriting is idempotent via
`upsert`; reorders bulk-update `sortOrder` inside a single transaction
that pre-verifies every row belongs to the caller.

The GraphQL `Favorite.entity` field is a union (`Issue | Project |
Initiative | CustomView | Cycle | Document | Team`). Resolution dispatches
per `entityType` and returns `null` for missing or cross-org targets — the
sidebar component skips null entries rather than 404ing. This makes
cleanup of stale references entirely a read-time concern: no background
job, no FK to maintain across seven entity tables.

```sql
CREATE UNIQUE INDEX favorites_user_entity_uniq
  ON favorites(user_id, entity_type, entity_id);
```

**Why not polymorphic FKs?** The earlier draft (DATABASE_SCHEMA.md §2.18,
pre-2026-05-21) had one nullable FK per target type. That requires schema
churn every time a new favorite-able entity ships, and the FK enforcement
catches a class of bug (cross-org reference) that the per-resolver
`organizationId !== ctx.orgId` check already catches with the same effect.

Reference: `src/server/services/favorite.service.ts`,
`src/server/graphql/resolvers/favorite.ts`.

## 48. Guest Role Enforcement Pattern (2026-05-21, hardened post-review)

`TeamMemberRole.role` carries one of `admin | member | guest`. The
middleware layer exposes four guards:

- `requireTeamMember(prisma, teamId, userId, orgId)` — passes for any role
  (legacy; kept for paths that gate by team membership but don't
  differentiate guests)
- `requireTeamMemberNotGuest(...)` — same as above but rejects guests
  with `FORBIDDEN`; used when an action shouldn't be available to
  guests at all (none today — guests can still interact with their
  own work via the helper below)
- `requireIssueAccessNotGuestOrOwn(prisma, issue, userId, orgId)` —
  per-issue write guard: passes for non-guests; for guests, passes
  only when `issue.creatorId === userId || issue.assigneeId === userId`.
  Every per-issue mutation (snooze, unsnooze, update, archive,
  delete, reactions, bulk update) goes through this.
- `isTeamGuest(...)` / `getGuestTeamIds(prisma, userId, orgId)` —
  boolean lookups; read paths use these to narrow result sets so the
  guest only sees issues they created/are assigned to.

**Critical invariant:** `IssueFilter.guestUserId` is server-derived from
`isTeamGuest`; never accepted from clients. A client-supplied value would
let a member pose as a guest to scope a query — harmless on its own, but
the principle is "trust nothing from the wire about role state".

```ts
// Top-level issues query (the primary read-path enforcement):
await requireTeamMember(ctx.prisma, filter.teamId, ctx.userId, ctx.orgId);
const guest = await isTeamGuest(ctx.prisma, filter.teamId, ctx.userId, ctx.orgId);
const effectiveFilter = guest ? { ...filter, guestUserId: ctx.userId } : filter;
```

**Relation resolvers** (Project.issues, Cycle.issues, Issue.children,
Issue.parent) independently re-check guest status — without that, those
paths are backdoors around the top-level filter. The Project.issues
path is the tricky one: a project can span teams, so it asks
`getGuestTeamIds` once and applies an `OR` clause that allows full
visibility for non-guest teams and creator-or-assignee for guest teams.

```ts
// Project.issues — guest-scoped where clause:
const guestTeamIds = await getGuestTeamIds(ctx.prisma, userId, orgId);
where.OR = guestTeamIds.length > 0
  ? [
      { teamId: { notIn: guestTeamIds } },
      { creatorId: userId },
      { assigneeId: userId },
    ]
  : undefined;
```

**Write-path sweep (2026-05-24):** `commentCreate`, `issueRelationCreate`,
and `issueRelationDelete` also call `requireIssueAccessNotGuestOrOwn` so
guests cannot create comments, create relations, or delete relations on
issues they don't own or aren't assigned to.

Reference: `src/server/middleware/auth.ts`,
`src/server/graphql/resolvers/issue.ts`,
`src/server/graphql/resolvers/comment.ts`,
`src/server/graphql/resolvers/issue-relation.ts`,
`src/server/graphql/resolvers/project.ts`,
`src/server/graphql/resolvers/cycle.ts`.

## 49. Issue Snooze Pattern (2026-05-21)

`issues.snoozed_until_at` / `snoozed_by_id` columns existed since schema
inception but had no API. Mutations `issueSnooze(id, until)` and
`issueUnsnooze(id)` thread through `IssueService.snooze` / `unsnooze` —
just sets / clears the columns.

**Wakeup is a read-time concern:** there is no background worker that
flips snoozed issues back into the active set on the wake timestamp.
The `IssueService.buildWhere` query helper enforces the hide rule
server-side as

```sql
snoozed_until_at IS NULL OR snoozed_until_at <= now()
```

added under an `AND` clause so it composes cleanly with the guest-
visibility filter (also AND'd). Clients pass `IssueFilter.includeSnoozed:
true` to opt in (e.g. a dedicated "snoozed" view). The DB row stays
the same throughout the snooze window; only the read interpretation
changes.

**Validation:** the resolver rejects `until` values that are non-ISO,
`NaN`, or `<= now()`. A snooze "to the past" silently no-ops in Linear,
but here we'd rather surface the input mistake (likely a timezone bug
in the client) than absorb it.

Reference: `src/server/services/issue.service.ts:snooze`,
`src/server/services/issue.service.ts:buildWhere`,
`src/server/graphql/resolvers/issue.ts:issueSnooze`.

## 50. Bulk Update Pattern (2026-05-21)

`issuesBulkUpdate(ids, input)` applies the same `IssueUpdateInput` patch
to up to 200 issues atomically.

**Three deliberate design choices:**

1. **Auto-close cascades are skipped.** Bulk operations are manual
   reorganisations (drag-select 50 backlog issues into a project, change
   priority on an entire backlog). Running per-row cascades would silently
   transition unrelated parents/children — the opposite of what the user
   intended.

2. **Hard cap of 200.** Matches Linear's bulk-toolbar cap. Past this, the
   request slot is held too long; the client should batch into multiple
   calls.

3. **stateId is cross-team-checked.** If a target state is supplied, every
   issue in the batch must belong to the team that owns the state. Mixed-
   team batches with a state change throw `BAD_USER_INPUT` rather than
   succeed-partially.

The resolver emits one SyncAction + one webhook event per row sequentially
to preserve commit ordering across the batch (and so subscribers see each
row update live, not as one batched WS message).

Reference: `src/server/services/issue.service.ts:bulkUpdate`,
`src/server/graphql/resolvers/issue.ts:issuesBulkUpdate`.

---

## 51. YJS Collaborative Editing (2026-05-22)

Real-time multi-cursor co-editing on issue descriptions via Hocuspocus + YJS.

### Three-process dev setup

```
yarn dev         # Next.js, port 3000
yarn ws:server   # Sync WebSocket, port 3001
yarn yjs:server  # Hocuspocus YJS server, port 1234
```

### Document naming

Each collaborative document has a unique name used by the Hocuspocus room:

- **Issue description:** `issue:<uuid>` (e.g. `issue:abc-123-...`)
- **Document content:** `document:<uuid>` — active as of 2026-05-22 (`Document.contentState Bytes?` added in migration `20260522000000`)

### Auth: ws_ticket reuse

The Hocuspocus `onAuthenticate` hook receives the token sent by
`HocuspocusProvider` on the client. The client calls `fetchWsTicket()`
(which hits `GET /api/auth/ws-ticket`) and passes the 60s ticket as the
provider's `token` option. The server verifies with `verifyWsTicket` (same
function used by the sync WebSocket) — same secret, same 60s expiry, same
scoped `type: 'ws_ticket'` claim (§18).

On reconnect, `HocuspocusProvider` re-calls the async `token` function,
which re-fetches a fresh ticket. This mirrors the sync WebSocket's
per-reconnect ticket refresh.

### Persistence: `Issue.descriptionState Bytes?`

`onLoadDocument`: loads the stored YJS state bytes and applies them to the
in-memory YJS doc with `Y.applyUpdate`.

`onStoreDocument`: encodes the full YJS state with `Y.encodeStateAsUpdate`
and writes to `Issue.descriptionState` as a `Buffer`. Debounced 2s,
hard-capped at 20s, so fast typing doesn't hammer the DB.

### Tenant guard

`onAuthenticate` verifies the document entity (`issue:<id>`) belongs to
the `orgId` from the ws_ticket. Archived issues are rejected
(`archivedAt: null` in the WHERE). The context object (`{ orgId, userId }`)
is stamped and forwarded to subsequent hooks.

### Cold-start seeding

When the first client connects to an issue that has no stored `descriptionState`,
`onLoadDocument` returns without applying any bytes (doc stays empty).
After the provider syncs (`onSynced: { state: true }`), the client checks
if the YJS fragment `'default'` is empty. If so AND the `content` prop
(the saved HTML from the `description` column) is non-empty, the client
calls `editor.commands.setContent(content)` to seed the YJS doc. This
triggers `onStoreDocument` (debounced), which persists the YJS state.
Subsequent clients then load the seeded state from `descriptionState`.

### Resolution policy

The existing `onBlur` callback in `IssueDetailPanel` saves the editor's
current HTML (`editor.getHTML()`) to `Issue.description` via `issueUpdate`
GraphQL mutation. Since `editor.getHTML()` reflects the merged YJS state
(including remote updates from collaborators), this keeps the plain-text
`description` column in sync with the collaborative state. Search, sync
broadcasts, webhooks, and email notifications all continue to use the
`description` column unchanged.

### Feature flag

Set `NEXT_PUBLIC_COLLAB_ENABLED=true` and `NEXT_PUBLIC_YJS_SERVER_URL`
to enable collaborative editing in the UI. Without the flag, `TipTapEditor`
behaves exactly as before (no YJS connection, no performance overhead).

### Client integration

`TipTapEditor` accepts two new optional props:

```typescript
collabDocId?: string;    // e.g. "issue:<uuid>"
collabUserName?: string; // display name for the presence cursor
```

When `NEXT_PUBLIC_COLLAB_ENABLED=true` and `collabDocId` is provided AND
`readOnly=false`, the editor:

1. Creates a `Y.Doc` and `HocuspocusProvider` (synchronously at mount, so
   they're available for `useMemo` extensions).
2. Includes `Collaboration.configure({ document: ydoc })` which replaces
   the StarterKit's `undoRedo` extension (Yjs provides its own undo/redo).
3. Includes `CollaborationCursor.configure({ provider })` for presence indicators.
4. Stamps cursor awareness: `{ color: <random session color>, name: collabUserName }`.

### Deferred

- "Users editing now" avatar stack
- View-only collaborator role
- Persistent cursor colors across sessions

## 52. Favorites Sidebar (2026-05-22)

Favorites are fetched via `favorites { favorites { ... } }` GraphQL query on sidebar mount.
`FavoriteStore` holds the pool; `applySyncAction` keeps it live via WebSocket deltas.
The sidebar renders a "Favorites" section above Teams when any favorites exist.
Remove via the × button that appears on hover. Bootstrap does not include favorites
(they're user-scoped and low-volume, so fetch-on-mount is fine).

## 53. Sub-Initiatives Tree (2026-05-22)

`InitiativeStore.roots` returns only top-level items (no `parentId`).
`InitiativeStore.getChildren(parentId)` returns direct children sorted by `sortOrder`.
`InitiativeRow` renders recursively at `depth + 1` so sub-initiatives appear indented.
Sub-initiatives are always visible (not hidden behind the expand toggle — the toggle
only controls the projects + updates panel for the current initiative).

## 54. Issue Timeline View (2026-05-22)

A third view mode (`'timeline'`) added to `ViewToggle` (Alt+3).
`GanttView` is wired to the team issue list using `startDate` / `dueDate`.
Only issues that have at least one of those set are shown.
`onChange` dispatches `issueUpdate({ startDate, dueDate })` via the existing
`handleUpdate` callback with optimistic MobX updates and rollback on error.

## 55. Issue Mentions in Editor (2026-05-22)

`TipTapEditor` accepts an optional `mentionIssues?: MentionItem[]` prop.
When provided, a second Mention extension instance (name: `'issueMention'`)
is added with `#` as the trigger character, allowing inline issue references.
Items are `{ id, label: identifier, sub: title }` — the dropdown shows the
identifier on the left and title on the right. The `@` trigger for user
mentions is unchanged.

## 56. Project Mentions in Editor (2026-05-24)

Extends the §55 pattern. `TipTapEditor` gains an optional
`mentionProjects?: MentionItem[]` prop. When provided,
`buildProjectMentionExtension` adds a third Mention extension instance
(name: `'projectMention'`) with `~` as the trigger character.

The three triggers are independent — `@` users, `#` issues, `~` projects.
Items for project mentions are `{ id, label: projectName }`. The extension
is omitted from the editor entirely when `mentionProjects` is not passed,
keeping the bundle impact zero for editors that don't need it.

## 57. Label Group Enforcement Pattern (2026-05-24)

Three constraints enforce Linear's label-group semantics:

1. **Depth guard** — `LabelService.create` and `LabelService.update` both
   reject `parentId` when the prospective parent itself has a `parentId`
   (max 1 nesting level). Error: `LabelGroupDepthError` → `BAD_USER_INPUT`.

2. **Capacity guard** — `LabelService.create` rejects when the parent already
   has ≥ 250 non-archived children. The count and insert are wrapped in a
   `$transaction` so two concurrent creates cannot both pass the 249 → 250
   threshold. `LabelService.update` runs the same check when `parentId`
   changes, excluding the label being moved from the sibling count.
   Error: `LabelGroupCapacityError` → `BAD_USER_INPUT`.

3. **Single-select per group** — `IssueService.syncLabels` calls the private
   `enforceSingleSelectPerGroup(tx, labelIds)` helper before writing
   `issueLabelAssignment` rows. It fetches the `parentId` of each requested
   label and, for any group that appears more than once, keeps only the
   last label in the caller's input order (last-writer-wins).

The label activity diff in `issueUpdate` re-fetches the persisted label set
after `syncLabels` runs, so labels dropped by single-select deduplication
are not logged as added.

## 58. Duplicate Relation Auto-Cancel Pattern (2026-05-24)

When `IssueRelationService.create` is called with `type='duplicate'`:

1. Inside the existing `$transaction`, after inserting the relation, the
   service fetches the duplicate issue (`issueId`) and its current workflow
   state. If the state type is neither `completed` nor `canceled`, it
   transitions the issue to the team's first `canceled` workflow state via
   `tx.issue.update`.

2. The service captures `dup.stateId` as `canceledIssueOldStateId` **before**
   the update — this is the source-of-truth `oldValue` for the activity
   record and avoids a TOCTOU race where a concurrent state change between
   the resolver's `findById` and the transaction commit would produce the
   wrong audit trail.

3. The resolver emits a `SyncAction('U', 'Issue')` for the canceled issue,
   then calls `ctx.services.issue.update(canceledIssue.id, { stateId })` with
   the same stateId. This call is effectively a no-op for the state column but
   triggers the `autoCloseParentIssues` / `autoCloseChildIssues` cascade path
   inside `IssueService.update`. Any cascade-closed issues receive their own
   SyncActions.

4. The inverse (re-opening the issue when the duplicate relation is deleted)
   is intentionally out of scope — once canceled, manual re-open is required.

## 59. iCal Cycle Feed Pattern (2026-05-24)

Per-user calendar subscription for cycle dates:

- `users.calendar_feed_token VARCHAR(64) UNIQUE` — stores a 32-byte random
  hex token in plaintext. Rotating the token (`userCalendarFeedTokenRotate`
  mutation, `crypto.randomBytes(32).toString('hex')`) invalidates the old
  URL. No hashing — the token is low-value (exposes only cycle dates, not
  issue content).
- `GET /api/cycles/feed/[token].ics` (`runtime: 'nodejs'`) — looks up the
  user by token, fetches non-archived/non-completed cycles for all teams the
  user belongs to, and emits a RFC 5545 VCALENDAR. `DTEND;VALUE=DATE` uses
  `cycle.endsAt` directly (exclusive semantics — the next cycle starts at
  `endsAt`, so no +1 offset is needed).
- `User.calendarFeedUrl` field resolver returns null for any viewer other
  than the authenticated user, preventing token leakage via nested User
  queries.
- Settings page "My Preferences" section exposes a read-only URL input with
  a copy-to-clipboard button and a rotate button that calls the mutation and
  updates local state.

## 60. Initiative Health Badge Pattern (2026-05-24)

`Initiative.health` is a pure GraphQL resolver derivation — no DB column:

```ts
health: async (initiative, _args, ctx) => {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const latest = await ctx.prisma.initiativeUpdate.findFirst({
    orderBy: { createdAt: 'desc' },
    select: { health: true },
    where: { archivedAt: null, createdAt: { gte: since }, initiativeId: initiative.id },
  });
  if (latest) return latest.health;
  const p = initiative.progress; // persisted Float
  if (p >= 0.67) return 'onTrack';
  if (p >= 0.33) return 'atRisk';
  if (p > 0) return 'offTrack';
  return 'unknown';
},
```

`initiative.progress` is always present on the DB row (Float `@default(0)`),
so the fallback never throws even on newly created initiatives.

## 61. Audit Log Pattern (2026-06-06)

All security-relevant events are recorded as append-only rows in `audit_log_entries`:

- **`AuditLogService.log(input)`** — fire-and-forget (returns `void`, swallows errors internally). Call with `void ctx.services.auditLog.log({...})` in resolvers — never `await`.
- **`AuditLogService.findByOrg(filter)`** — cursor-paginated (DESC by `createdAt`), max 200 per page. Returns `{ entries, hasMore, nextCursor }`.
- **Auth resolver coverage** — `emailVerify` emits `auth.login`; `logout` emits `auth.logout`; SAML callback emits `auth.login` with `metadata: { method: 'saml' }`.
- **Org/team mutations** — `teamCreate` → `team.created`; `teamDelete` → `team.deleted`; `organizationMemberUpdateRole` → `member.role_changed`.
- **Issue mutations** — `issueDelete` → `issue.deleted`; `issuesBulkUpdate` → `issue.bulk_updated`.
- **SAML config** — `samlConfigurationSave` → `saml.enabled` or `saml.configured`; `samlConfigurationDelete` → `saml.disabled`.
- **SCIM tokens** — `scimTokenCreate` → `scim.token_created`; `scimTokenRevoke` → `scim.token_revoked`.
- **Admin-only read** — `auditLogs(filter)` query requires `owner` or `admin` role. Settings page at `/settings/audit-log`.
- **`AuditAction` union** — all valid action strings are enumerated in `audit-log.service.ts` for type safety.

## 62. SAML SSO Pattern (2026-06-06)

SP-initiated SAML 2.0 SSO using Node.js built-ins only (no external SAML library):

- **`SamlService`** — `getConfig`, `saveConfig`, `deleteConfig`, `generateSpMetadata`, `buildAuthnRequest`, `parseAndValidateResponse`, `jitProvisionUser`.
- **Routes** — `GET /api/auth/saml/metadata?org=<urlKey>` (SP metadata XML); `GET /api/auth/saml/initiate?org=<urlKey>&redirect=<path>` (builds AuthnRequest, stores relay in `saml_relay` httpOnly cookie, redirects to IdP); `POST /api/auth/saml/callback` (parses Response, JIT-provisions user, issues JWT pair, redirects to workspace).
- **JIT provisioning** — `jitProvisioning: true` (default) creates the user on first SSO login; `false` requires pre-existing account.
- **`ssoEnforced`** — reserved field for future enforcement of SSO-only login (UI toggle present, enforcement not yet wired into the password/magic-link flow).
- **Response validation** — `parseAndValidateResponse` extracts `<saml:Issuer>` and rejects responses where it does not match `config.idpEntityId`. It then calls `verifyXmlSignature` which: (1) verifies the `<ds:SignedInfo>` RSA-SHA256/SHA1 signature via `crypto.createVerify`; (2) extracts the `<ds:Reference URI="#id">` to locate the signed element by ID; (3) validates `<ds:DigestValue>` against the element content to detect content substitution; (4) returns the signed XML fragment. All claim extraction (NameID, email, name) is performed on that fragment only — preventing XML signature-wrapping attacks where unsigned content is injected alongside the signed Assertion. Whitespace-only normalization is used instead of full Exclusive C14N — adequate for conformant IdPs (Okta, Azure AD, Google Workspace). Unsigned or tampered responses throw `SamlParseError`.
- **`idpCert` handling** — `SamlConfigInput.idpCert` is optional. `saveConfig` preserves the existing stored PEM when `idpCert` is omitted, so admins can edit other fields (SSO URL, attributes, enforcement) without re-entering the certificate. `idpCert` is required on first-time creation (falls back to empty string, which will fail signature verification).
- **Open redirect** — the SAML callback sanitizes the relay-state redirect path: must start with `/` but not `//` (protocol-relative URL guard).
- **GraphQL** — `samlConfiguration` query + `samlConfigurationSave` / `samlConfigurationDelete` mutations, all `owner`/`admin` only. Return types `SamlConfigurationPayload` and `SamlDeletePayload` intentionally omit `lastSyncId` (config is not synced to the org stream — see `WebhookDeletePayload` for the same precedent).
- **Settings** — `/settings/security` page (Security section).

## 63. SCIM 2.0 Provisioning Pattern (2026-06-06)

RFC 7644-compliant SCIM 2.0 provisioning API gated by Bearer token:

- **Tokens** — `ScimService.createToken(orgId, userId, label)` generates a 64-char hex plaintext token, stores only its SHA-256 hash. Plaintext is returned once at creation (UI shows a copy-once warning). `revokeToken` sets `revokedAt`; `authenticateScimToken` hashes the incoming bearer and looks up non-revoked rows, updating `lastUsedAt` non-blocking.
- **Base URL** — `<APP_URL>/api/scim/v2`.
- **Users resource** — `GET /Users` (list, `userName eq "email"` filter, 1-based pagination), `POST /Users` (upsert by email, add to org; never writes `user.active` — SCIM (de)activation is org-scoped), `GET /Users/:id`, `PUT /Users/:id`, `PATCH /Users/:id` (Operations array — handles `replace`, `add`, and `remove` ops; `active: false` removes org membership + all team memberships within the org; `active: true` re-provisions org membership via upsert so a previously deactivated user regains workspace access), `DELETE /Users/:id` (removes org membership + team memberships; does **not** globally deactivate `users.active` — deactivation is org-scoped).
- **Groups resource** — maps to Teams. `GET /Groups` (list, single batched member query), `POST /Groups` (create team with auto-generated key; key collision uses incrementing loop to avoid race conditions), `GET /Groups/:id`, `PUT /Groups/:id` (replace name + sync members; validates member userIds against org membership before insert), `PATCH /Groups/:id` (add/remove members, rename; `add` validates against org membership; `remove` handles both bare `members` path and RFC 7644 value-filter `members[value eq "userId"]` for Azure AD compatibility), `DELETE /Groups/:id` (archives team).
- **GraphQL** — `scimTokens` query + `scimTokenCreate` / `scimTokenRevoke` mutations, `owner`/`admin` only. Return types `ScimTokenCreatePayload` and `ScimTokenRevokePayload` omit `lastSyncId` (same precedent as SAML/webhook).
- **Settings** — SCIM section on `/settings/security` page above SAML.

## 64. Analytics Extension Pattern (2026-06-06)

Analytics features added in this sprint extend the existing `AnalyticsService`:

- **`cycleScopeAndCarryover(cycleId)`** — returns `{ plannedCount, scopeCreepCount, scopeCreepPct, carryoverCount, carryoverPct, completedCount, totalCount }`. `scopeCreepCount` = issues with `addedToCycleAt IS NOT NULL` minus `carryoverCount` (carryover issues also have `addedToCycleAt` set via rollover but are not genuine scope creep). Carryover uses the stamped `Cycle.carryoverCount` column. Resolver requires the caller to be a member of the cycle's team.
- **`analyticsWorkspaceOverview`** — restricted to `owner`/`admin` org roles (workspace-aggregate data is not visible to plain members).
- **`workspaceOverview(orgId)`** — returns org-level aggregates plus per-team stats. Performance note: currently does O(N) Prisma calls for N teams; acceptable for small-to-medium orgs but should be batched into a single SQL CTE for large orgs.
- **`Cycle.carryoverCount`** — `Int @default(0)` column stamped by `CycleService.rollover()` on the *destination* cycle when issues are moved. Historical cycles have `0` until the next rollover.
- **Workspace analytics page** — `/analytics` (uses `analyticsWorkspaceOverview` query). Added as `BarChart2` entry in the sidebar `globalNavItems`.
- **Cycle scope metrics** — shown in `CycleDetailView` as 4 stat cards (planned / scope creep / carryover / completed) when carryover or scope creep > 0.

## 65. My Issues Cross-Team View (2026-06-07)

Global view of all non-trashed, non-archived issues assigned to the current user across every team:

- **Route** — `/(workspace)/[workspace]/my-issues` (sidebar shortcut `G` then `I`).
- **Data source** — `issueStore.pool` filtered by `assigneeId === currentUser.id && !i.trashed && !i.archivedAt`; no GraphQL query needed (bootstrap already loaded all org issues).
- **View modes** — List / Board / Timeline, toggled with Alt+1/2/3. Board supports group-by (status / assignee / priority) and swimlane (none / assignee / priority).
- **FilterBuilder** — same `applyFilters(issues, filterSet)` engine used on team pages.
- **Keyboard shortcuts** — j/k navigate, Enter opens detail, Escape closes; s/a/p/l/d/Shift+E open inline property editors.
- **MobX deps** — `issueStore.pool.size` + `userStore.pool.size` as reactive triggers (not the Map itself) per store convention.

## 66. Sub-Issue Progress Rollup UI (2026-06-07)

Progress bar and completion counter added to the Sub-issues section header in IssueDetailPanel:

- **Location** — `src/components/issues/sub-issue-list.tsx`, inside the `SubIssueList` component.
- **Computation** — `completedCount` is computed inside the existing `useMemo` that also builds `grouped`, by counting issues whose `workflowStateStore.findById(issue.stateId)?.type === 'completed'` in the same loop. This avoids a second O(n) store-lookup pass outside the memo.
- **Rendering** — shown only when `subIssues.length > 0`: a `{completedCount}/{subIssues.length}` counter and a `w-20 h-1 rounded-full` progress track with a `bg-green-500` fill proportional to `completionPct`.

## 67. Personal API Tokens (2026-06-07)

Scoped long-lived tokens for programmatic API access (`bil_` prefix):

- **Schema** — reuses existing `auth_tokens` table (`type: 'api_key'`, 1-year expiry, SHA-256 hash stored).
- **Service** — `AuthService.createApiToken(userId, label)` / `listApiTokens(userId)` / `revokeApiToken(userId, id)`. `listApiTokens` filters `expiresAt: { gt: new Date() }` so expired tokens are excluded from the UI.
- **Auth middleware** — `extractAuthContext` in `src/server/middleware/auth.ts` falls through to API key check when JWT verification fails. Uses `select` (not `include`) to fetch only `id`, `userId`, and `orgMemberships.organizationId` — avoids loading the full User row on every authenticated API request.
- **Multi-org** — API key auth scopes to the user's oldest org (`orderBy: { createdAt: 'asc' }, take: 1`). This is a known limitation; tokens are not org-scoped at the DB level.
- **GraphQL** — `apiTokens: [ApiToken!]!` query + `apiTokenCreate(label)` + `apiTokenRevoke(id)` mutations. All in `userResolvers`.
- **Settings UI** — `/settings` page shows a one-time plaintext banner (copy + dismiss), label input, and a list of active tokens with revoke buttons.

## 68. Keyboard Shortcut Help Modal (2026-06-07)

`?` opens a full shortcut reference modal listing all registered hotkeys grouped into 5 sections: Global, Navigation, Issue List, Issue Actions, and View.

- **Component** — `src/components/layouts/shortcut-help-modal.tsx`. Plain div overlay + centered card (no shadcn Dialog). Closes on Escape or outside-click.
- **Registration** — `useHotkeys('?', ...)` in `workspace-client.tsx`. Suppressed when focus is inside an input/textarea (default hook behaviour).
- **`kbd` styling** — `rounded border border-zinc-200 bg-zinc-100 px-1.5 py-0.5 text-xs font-mono dark:border-zinc-600 dark:bg-zinc-800`.

## 69. Bulk Actions Toolbar (2026-06-07)

Multi-select checkboxes in the issue list view with a floating action bar for batch mutations.

- **Entry point** — `IssueListView` accepts `onBulkUpdate?: (ids: string[], patch) => void`. When present, each `IssueRow` checkbox enters bulk-select mode (uses `checked`/`onCheck` props instead of the single-select `selected`/`onSelect`).
- **Range select** — Shift+click extends selection from the last-checked index, mirroring the board view's pattern.
- **`BulkActionBar`** — fixed bottom bar (`src/components/issues/bulk-action-bar.tsx`). Appears when `checkedIds.size > 0`. Provides Status / Priority / Assignee / Label `SelectPopover` dropdowns; clears selection after applying. Imports `StatusDot` from `@/components/properties/status-select` — do not redefine it locally.
- **Mutation** — `issuesBulkUpdate(ids, input)` on team page and My Issues page. Snapshots each issue via `issueStore.findById` before the optimistic update; rolls back on `onError`, applies server-returned issues via `applySyncAction` on `onSuccess`.
- **Selection reset** — `IssueListView` derives `issueIds = issues.map(i => i.id).join(',')` via `useMemo` and resets `checkedIds` in a `useEffect` when it changes, so stale selections are cleared automatically when filters or team context changes.
- **Checkbox accessibility** — bulk-mode checkbox uses `onChange` (fires for both mouse and keyboard/Space) to call `onCheck(shiftKey)`; `onClick` only calls `stopPropagation`. Never use `readOnly` on a checkbox in bulk mode.

## 70. Cycle Burndown Chart (2026-06-07)

True agile burndown chart alongside the existing burnup chart in `CycleDetailView`.

- **Component** — `src/components/cycles/burndown-chart.tsx`. SVG-based (600×300 viewBox), same axes/grid/date-label pattern as `burnup-chart.tsx`. Plots remaining issues (indigo line) against an ideal straight-line burndown from initial scope to 0 (dashed gray).
- **UI** — tab toggle between "Burndown" and "Burnup" in `cycle-detail-view.tsx`.
- **Y-axis scale** — `maxY = Math.max(...data.map(d => Math.max(d.remaining, d.scope)), 1)`. Using only the day-0 scope would clip scope creep (remaining > initial scope) off the SVG viewport.

## 71. Issue Templates CRUD UI (2026-06-07)

Template management section in the team settings page.

- **Component** — `src/components/issues/issue-templates-section.tsx` (`IssueTemplatesSection`). MobX `observer`; reads from `issueTemplateStore.findByTeamId(teamId)`.
- **Form fields** — name, description (textarea), status/priority/assignee defaults (populated from team stores), label multi-toggle, "Set as default" checkbox.
- **Mutations** — `issueTemplateCreate` / `issueTemplateUpdate` / `issueTemplateDelete`. Applies `applySyncAction` after each write for immediate UI update.
- **Location** — rendered in `team/[key]/settings/page.tsx` between Custom Fields and Danger Zone.
- **Priority guard** — use `td.priority !== undefined && td.priority !== null` (not a truthy check) to gate the priority display chip; priority 0 ("No priority") is falsy but valid.

## 72. Project Milestones UI (2026-06-07)

Inline milestone management in the project detail view.

- **Component** — `src/components/projects/project-milestones-section.tsx` (`ProjectMilestonesSection`). MobX `observer`; reads from `projectStore.getMilestones(projectId)`.
- **Form** — inline create/edit with name, description, and target date (date input). Delete confirms via `window.confirm`.
- **Mutations** — `projectMilestoneCreate` / `projectMilestoneUpdate` / `projectMilestoneDelete`. Create and update request the milestone fields in the response and call `projectStore.applyMilestoneSyncAction` immediately so the list updates without waiting for the WebSocket SyncAction. Delete calls `applyMilestoneSyncAction('D', id, null)` immediately.
- **Location** — replaces the old read-only milestones block in `project-detail-view.tsx`.

## 73. GraphQL Mutation Centralization (2026-06-08)

Convention for where to put GraphQL operation strings.

- **Single-use mutations** — define inline in the component file that owns them (e.g. `CUSTOM_VIEW_CREATE_MUTATION` in `team/[key]/page.tsx`).
- **Shared mutations** — export from `src/lib/graphql-queries.ts`. Current shared exports: `ISSUE_CREATE_MUTATION`, `ISSUE_UPDATE_MUTATION`, `ISSUES_BULK_UPDATE_MUTATION`, `ISSUE_ARCHIVE_MUTATION`.
- **Field-set fragments** — declare as a private (non-exported) `const` in the same file, then interpolate into mutations via template literals (e.g. `const ISSUE_FIELDS = \`...\``). This mirrors the existing `COMMENTS_FRAGMENT` pattern. Do **not** export the fragment unless a consumer outside the file needs it directly.
- **File organisation** — `graphql-queries.ts` sections are ordered: Auth → Teams → Sidebar/Favorites → Issues (queries) → Issues (mutations) → Comments → Issue Reactions → Cycles → Notifications → Projects → Initiatives. New domains append a new `// ── Domain ──` section at the bottom.

## 74. Platform Admin Console (2026-07-03)

Cross-tenant operator layer that sits **above** every organization — the app's first privilege that is not org-scoped.

- **Privilege model** — a single `User.isPlatformAdmin` boolean. There is no role tier above org `owner`; platform admin is orthogonal to org/team roles. The **first user created in an empty deployment** is bootstrapped to `true` via the shared `UserService.isFirstUser(client)` helper, called from **every** user-creation path — magic-link/OAuth (`findOrCreate`), SAML JIT (`jitProvisionUser`), and SCIM (`Users` route) — so a fresh install always gets an operator regardless of how the first user signs in. Thereafter admins grant/revoke via the console (guarded so the last admin can neither be revoked nor suspended). On an **existing** (non-empty) database no one has the flag yet — promote the first operator once with `yarn admin:grant <email>` (`scripts/grant-platform-admin.ts`, idempotent; `--revoke` for recovery). See DATABASE_SCHEMA.md §2.37.
- **Authorization** — `requirePlatformAdmin(prisma, ctx)` in `src/server/middleware/auth.ts`. It rejects non-admins (FORBIDDEN), rejects any **impersonated** session (`ctx.impersonatorId` set) so borrowed sessions can't wield platform powers, and returns the admin's `userId`. Every `platform*` resolver and the impersonation routes call it first. Assertion signatures can't be async, so it returns the id rather than narrowing `ctx`.
- **Cross-tenant service** — `PlatformAdminService` deliberately queries across orgs (no `orgId` scoping); this is only safe because it is unreachable except through `requirePlatformAdmin`. It owns tenants (list/detail/suspend/restore/soft-delete), users (list/suspend/reactivate/grant-revoke-admin, with a **last-admin guard**), metrics, impersonation-target resolution, and a `platform_audit_logs` write trail.
- **Suspension enforcement** — `extractAuthContext` now does two PK lookups per authenticated request: a suspended user (`active=false`) is fully logged out; a suspended/archived org drops only `orgId` (so an admin whose own org is suspended keeps console access, which needs `userId` only). Suspension therefore takes effect on the very next request, no session revocation needed.
- **Impersonation** — handled by API routes (`/api/admin/impersonate[/stop]`), NOT GraphQL, because they rewrite the `access_token` cookie server-side. Both routes carry the same Origin/CSRF guard as `/api/graphql` (via `isOriginAllowed`). Start mints a 30-min `signImpersonationToken` carrying an `impersonatorId` claim and swaps it into `access_token`; on expiry the session simply falls back to unauthenticated (admin returns to login). Stop reads `impersonatorId` **directly from the token** (via `verifyAccessToken`, not `extractAuthContext`, so a mid-session target suspension can't strand the admin), re-verifies that account is still an admin, and re-issues a normal admin pair. `apiTokenCreate` is blocked while impersonating so a borrowed session can't mint a persistent credential. `ImpersonationBanner` (mounted in the workspace layout) polls `impersonationState` and offers the one-click exit.
- **UI** — a dedicated `(admin)` route group with its own server-component layout guard (bounces non-admins/impersonators before render) and `AdminShell` chrome. Pages: `/admin` (metrics), `/admin/tenants` (+ `/admin/tenants/[id]` detail with owners and per-owner impersonation), `/admin/users`, `/admin/audit`. Discoverable via a "Platform admin console" card on the workspace settings page, gated on `viewer.isPlatformAdmin`.
- **E2E** — `tests/e2e/platform-admin.spec.ts`. The seed marks `e2e@test.local` as a platform admin; the spec asserts the authz gate (non-admin `platform*` → FORBIDDEN), console navigation, the non-admin `/admin` redirect, and a full impersonation round-trip (start → scoped-down → banner → stop).
## 75. Internationalization (i18n) — English/Spanish (2026-07-03)

Client-side i18n layer supporting `en` (default) and `es`, modeled after the existing `next-themes` dark-mode pattern rather than URL-segment routing (`/en/...`), since routes are keyed by `[workspace]` and restructuring them was out of scope.

- **Dictionaries** — `src/lib/i18n/locales/{en,es}.json`. Flat-ish nested JSON, namespaced by feature (`common`, `nav`, `theme`, `language`, `auth`, `errors`, …). Keys are sorted (Biome `useSortedKeys` enforces this — run `yarn lint:fix` after editing).
- **Core lib** — `src/lib/i18n/index.ts` exports `locales`, `defaultLocale`, `localeNames`, `dictionaries`, `LOCALE_COOKIE`, the `Locale`/`Dictionary` types, and the shared `translate(locale, key, params?)` function. `translate()` is the single lookup+interpolation core: dotted-key resolve → English fallback → raw key, then `{placeholder}` substitution. **Both** the client `useTranslations()` hook and the server `getServerTranslations()` helper delegate to it, so key resolution, fallback, and interpolation are identical client- and server-side — do not hand-roll a second dotted-key walker (tests use `translate('en'|'es', …)` too). Interpolation passes the replacement as a *function* to `String.prototype.replaceAll`, so `$`-sequences in user-supplied values (issue titles, entity names) are inserted literally rather than treated as `$&`/`` $` ``/`$$` special patterns.
- **Provider** — `src/providers/locale-provider.tsx` (`LocaleProvider`, `useLocale`). Client context seeded from a server-read cookie (`RootLayout` reads `cookies()` and passes `initialLocale`, mirroring `attribute="class"` theme init) — no hydration-mismatch flash. `setLocale` persists to the `locale` cookie (1yr) and updates `document.documentElement.lang`. **Rendering-strategy tradeoff:** reading `cookies()` in the root layout opts every route into dynamic rendering (the cost of cookie-based locale without URL-segment routing). Acceptable here — the app is auth-gated and real-time, so it is dynamic anyway; the only public page (`/roadmap/[slug]`) is slug+password specific and per-request by nature.
- **Hook** — `src/hooks/use-translations.ts` (`useTranslations()`) returns a `t(key, params?)` function (a `useCallback` memoized on `locale`) that delegates to `translate()`. Usage: `t('nav.myIssues')`, or with params `t('auth.failedToStart', { provider: 'Google' })`.
- **UI toggle** — `src/components/language-toggle.tsx` (`LanguageToggle`), a two-way EN/ES cycle button styled identically to `ThemeToggle`; supports the same `compact` prop. Rendered in the sidebar footer (`src/components/layouts/sidebar.tsx`) next to `ThemeToggle`, both expanded and collapsed states.
- **Server components + translations** — a server component (e.g. a `page.tsx` with `export const metadata`) cannot call `useTranslations` directly (it's a client hook). Split translated headings into a small `'use client'` sibling component (see `LoginHeader`, `VerifyHeader`, `OnboardingHeader` in `src/components/auth/`) and import it into the server page instead of converting the whole page to a client component.
- **Coverage** — app-wide: sidebar/layout/command palette/notifications, the full auth flow, issues (list, board, detail panel, comments, relations, sub-issues, attachments, templates), projects (list, detail, milestones, updates, roadmap), cycles/analytics/roadmap/initiatives, teams/custom fields/documents/editor, and every settings page (workspace, team, security, webhooks, integrations, import/export, audit log, automations, triage). ~1,080 translation keys across 22 top-level namespaces (`common`, `nav`, `auth`, `issues`, `issueDetail`, `projects`, `properties`, `cycles`, `roadmap`, `analytics`, `initiatives`, `teams`, `customFields`, `documents`, `editor`, `layout`, `commandPalette`, `notifications`, `settings`, `theme`, `language`, `errors`).
- **Extending coverage** — add a namespaced key to *both* `en.json` and `es.json` (same shape), then call `t('namespace.key')` from a `useTranslations()`-backed client component. Never hardcode a second English copy elsewhere; grep the dictionaries first — many short strings (`common.cancel`, `common.save`, priority/status labels) are already shared across features.
- **Multi-agent authorship caveat** — this sweep was done by parallel agents each covering a disjoint file set, then reconciled by hand. Two structural bugs surfaced from that parallelism and are worth knowing about if similar sweeps happen again: (1) a `t` reference used inside a nested component that doesn't itself call `useTranslations()` (each component needs its own hook call — closures don't share it), and (2) a helper computed value (like `PRIORITY_OPTIONS`) defined once at the top of a file but referenced inside a sibling component that never received it — pass or recompute it locally. Both are caught by `yarn typecheck`, not `yarn lint`.
- **Fixed-enum labels are a recurring gap** — objects like `PRIORITY_CONFIG` (`src/lib/issue-utils.ts`) and `PROJECT_STATUS_CONFIG`/`PROJECT_HEALTH_CONFIG` (`src/lib/project-constants.ts`) bake an English `label` field in for color-pairing convenience. Rendering `.label` directly leaks untranslated English. The fix is a parallel `*_LABEL_KEYS: Record<string, string>` map (`PRIORITY_LABEL_KEYS` in `src/components/properties/priority-icon.tsx`, `PROJECT_STATUS_LABEL_KEYS`/`PROJECT_HEALTH_LABEL_KEYS` in `project-constants.ts`) — keep the `.color`/`.icon` fields on the original config object, but never read `.label` from it in a component. For priority specifically, resolve via the exported helper `priorityLabelKey(p)` (in `priority-icon.tsx`) → `t(priorityLabelKey(p))`; it centralizes the out-of-range fallback so call sites don't each hand-write `?? PRIORITY_LABEL_KEYS[0]` (which was duplicated ~15× and had already drifted — two sites omitted the fallback). Import `PROJECT_HEALTH_LABEL_KEYS` from `project-constants.ts`; don't re-declare a local copy.
- **Shared `lib/` helpers are an i18n blind spot** — plain TS utilities (not React components) are invisible to a component-by-component audit but are often called from many components at once. `formatRelativeTime` and `formatDueDate` in `src/lib/issue-utils.ts`/`src/lib/utils.ts` returned hardcoded English ("5m ago", "yesterday", `date-fns` `format(..., 'MMM d')` with no locale) — used by 7+ components (comments, activity timeline, notifications, project/initiative updates). Fixed by taking a `t`/`date-fns` `Locale` parameter instead of hardcoding; callers pass `useTranslations()`'s `t` and `DATE_FNS_LOCALES[locale]` (see `src/lib/date-fns-locale.ts`). When auditing for missed strings, grep `src/lib/*.ts` for `toLocaleDateString('en`, `date-fns` `format(` calls, and string literals returned directly from exported functions — not just JSX.
- **`INTL_LOCALES`** (`src/lib/i18n/index.ts`) and **`DATE_FNS_LOCALES`** (`src/lib/date-fns-locale.ts`) map the app `Locale` to `Intl`/`date-fns` locale tags respectively — use these instead of hardcoding `'en-US'` in any `toLocaleDateString`/`toLocaleString`/`date-fns format()` call.
- **Metadata titles/descriptions** — `export const metadata` is evaluated at build/request time outside React context and can't call `useTranslations()`. Use `export async function generateMetadata()` and call `getServerTranslations()` (`src/lib/i18n/server.ts`, which reads the `locale` cookie server-side) instead — see `src/app/layout.tsx` and the `(auth)` page files for the pattern.
- **App/brand name is centralized, not translated** — the product name is `APP_NAME` in `src/lib/app-config.ts` (defaults to `'Bilinear'`, overridable via `NEXT_PUBLIC_APP_NAME`). It is a proper noun, so it is NOT translated — import `APP_NAME` and interpolate it. Client components (sidebar, `LoginHeader`), server `generateMetadata()`, and server code (`src/server/lib/email.ts`) all import the same constant; never hardcode the brand string. i18n strings that embed the name use an `{appName}` placeholder filled from `APP_NAME` (e.g. `t('auth.signInTitle', { appName: APP_NAME })`), keeping the translated sentence structure separate from the configurable name. Wire-protocol tokens that happen to contain the name — the `X-Bilinear-*` webhook headers, the `User-Agent`, the `/bilinear` Slack command, iCal `PRODID`/`UID` — are stable identifiers external systems depend on and must stay literal.

### 75.1 Follow-ups (2026-07-04)

- **`useFormatters()` hook** — `src/hooks/use-formatters.ts` bundles the locale-bound formatters so components stop threading `t` + `DATE_FNS_LOCALES[locale]` through every `formatRelativeTime`/`formatDueDate` call by hand. Returns `{ formatRelativeTime, formatDueDate, formatDate(value, options?), formatDateTime(value, options?), intlLocale, dateFnsLocale }`, all pre-bound to the active locale (memoized on `[t, locale]`). `formatDate`/`formatDateTime` wrap `toLocaleDateString`/`toLocaleString` with `INTL_LOCALES[locale]` so a raw `new Date(x).toLocaleDateString('en-US')` never leaks. Prefer this hook over calling the `src/lib/*.ts` primitives directly from components; the primitives still take explicit `t`/`Locale` params for non-React callers.
- **Transactional emails are localized** — `src/server/lib/email.ts` no longer hardcodes English. Every `send*Email` takes a `locale?: string | null`, resolved through the private `emailT(locale, key, params)` helper (`translate(isLocale(locale) ? locale : defaultLocale, key, params)`) so an unknown/absent value falls back to `defaultLocale`. Strings live under the `email.*` namespace (`magicLink`, `assignment`, `mention`, `comment`, `statusChange`, plus `footer`/`viewIssue`/`viewComment`). HTML body keys receive already-escaped actor/issue-link markup as `{actor}`/`{issueLink}` params; the plain-text variants get the raw values. The recipient's language comes from the new **`User.locale`** column (see DATABASE_SCHEMA §2.1) — `NotificationService` selects `locale` alongside `email`/`emailNotificationsEnabled` and passes it through; `AuthService.sendMagicLink` passes the looked-up user's `user?.locale` (brand-new accounts have none yet → default). The column is written by the `userUpdateLocale(locale)` mutation, which `LocaleProvider.setLocale` fires (fire-and-forget) whenever the user switches language, keeping the cookie (UI) and the DB (emails) in sync. Server-side validation lives in `UserService.updateLocale` (throws `InvalidLocaleError` → `BAD_USER_INPUT`).
- **Platform admin console (`/admin`) is covered** — the `(admin)` route tree uses the `admin.*` namespace (`nav`, `dashboard`, `tenants`, `users`, `audit`, `impersonation`). The `layout.tsx` server component stays untranslated (guards/redirects only; its `metadata.title` can't reach a client hook). Dynamic status badges resolve keys like `admin.tenants.status.${status}` — keep every enum value represented in the dictionary. Watch for `t` shadowing: several admin list pages had `.map(t => …)` params renamed to `tenant`/`result` so they don't clobber the translation function.

### 75.2 Pluralization & first-visit locale (2026-07-04)

- **CLDR pluralization** — `translate()` handles grammatical plurals so "1 issue" / "2 issues" render correctly per locale (Spanish and English both distinguish `one`/`other`; the mechanism supports the full CLDR set — `zero`/`one`/`two`/`few`/`many`/`other` — for any language added later). Convention: a pluralizable key `foo.bar` is stored as **CLDR-category sibling keys** `foo.bar_one` and `foo.bar_other` (add `_few`/`_many`/etc. only when a locale needs them), each still using `{count}` for the number. When a caller passes `{ count }` (a number), `translate()` selects the category via a memoized `Intl.PluralRules`. Fallback order is **target-locale-first**: it tries the target locale's selected category, then the target locale's `_other`, and only then the default locale's forms — so a locale missing the selected category renders its own `_other` rather than leaking an English string mid-sentence. Keys **without** `_*` siblings are unaffected — the plural lookup returns `null` and falls through to the plain direct lookup — so `{count}`-bearing strings that don't need plural forms (parenthetical counts like `Issues ({count})`, abbreviated relative times like `{count}m ago`) stay as single keys. Do **not** hand-branch `count === 1 ? t('…Singular') : t('…Plural')` in components anymore — that older ad-hoc pattern (and the `issue(s)`/`row(s)` hacks) was migrated to `_one`/`_other`; just call `t('foo.bar', { count })`.
- **`{count}` is locale-number-formatted** — the `count` placeholder specifically is rendered through a memoized locale `Intl.NumberFormat`, so large counts get the locale's digit grouping (`1.500.000` in `es`, `1,500,000` in `en`; note Spanish's CLDR `minimumGroupingDigits=2` means 4-digit numbers like `1500` are *not* grouped). Every **other** placeholder is inserted verbatim via `String()` — years, ids, and pre-escaped HTML fragments must not be reformatted — so only name a numeric placeholder `count` when it is a cardinal you want grouped.
- **First-visit locale from `Accept-Language`** — `getServerLocale()` (`src/lib/i18n/server.ts`) still lets an explicit choice win (the `locale` cookie), but a visitor with no cookie yet now falls back to their browser's `Accept-Language` before the app default. Parsing lives in the pure, unit-tested `pickLocaleFromAcceptLanguage(header)` (`src/lib/i18n/index.ts`): it honors `q`-weights (not header order), matches on the base subtag (`es-MX` → `es`), skips `*`, unsupported languages, and `q=0` entries (RFC 7231 — `q=0` means the client explicitly rejects that language), and returns `null` when nothing matches. This reads `headers()` in the root layout, which — like the existing `cookies()` read — keeps every route dynamically rendered; no regression since the app is already dynamic (see §75).
- **Persisting the choice is fire-and-forget but not silent** — `LocaleProvider.setLocale` still writes `User.locale` via `userUpdateLocale` without awaiting, but it no longer swallows every error: `UNAUTHENTICATED` (expected on the pre-login `login`/`verify` pages) is ignored, while any other GraphQL/network failure is `console.warn`ed so a silently stale locale (→ wrong-language emails) is diagnosable.
- **Tests** — `src/lib/i18n/index.test.ts` covers plural category selection + fallback, `{count}` number grouping (and non-count passthrough), and the `Accept-Language` ranking/`q=0`/matching edge cases. Extend it when adding a locale with a richer plural rule set.
