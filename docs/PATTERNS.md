# Code Patterns
## Issue Tracker — Linear Rebuild

**Established:** Sprint 1-2  
**Last updated:** Sprint 9-10  
**Status:** Living document — updated each sprint

> This is the primary onboarding document for new contributors. All patterns here are the mandated conventions for the codebase. If you deviate from a pattern, document why.

---

## 1. Project Structure

```
src/
├── app/                        # Next.js App Router (pages + API routes)
│   ├── (auth)/                 # Route group: no sidebar, centered layout
│   ├── (workspace)/            # Route group: authenticated, sidebar layout
│   └── api/                    # API routes (GraphQL, session, sync)
├── server/                     # Backend-only code — never import from client
│   ├── graphql/                # schema.ts, context.ts, resolvers/, types/
│   ├── services/               # Business logic (one class per domain)
│   ├── lib/                    # Singletons: prisma, redis, jwt, email
│   ├── middleware/             # Auth extraction + guards
│   └── ws/                     # Standalone WebSocket server (separate process)
├── stores/                     # MobX observable entity pools (Sprint 7-8+)
├── providers/                  # React context wrappers (StoreProvider, SyncProvider)
├── components/                 # React components (client-safe)
│   ├── ui/                     # shadcn/ui primitives
│   ├── layouts/                # App shell, sidebar, WorkspaceClient
│   ├── command-palette/        # CommandPalette modal (Sprint 9-10+)
│   └── <feature>/              # Feature-grouped components (auth/, issues/, properties/)
├── hooks/                      # React hooks (useAuth, useHotkeys, useChord, useRecentItems)
├── lib/                        # Shared client utilities
│   ├── db.ts                   # Dexie.js IndexedDB schema (Sprint 7-8+)
│   ├── fuzzy-search.ts         # Local fuzzy match for store search (Sprint 9-10+)
│   ├── sync-manager.ts         # Sync lifecycle orchestrator (Sprint 7-8+)
│   ├── transaction-queue.ts    # Serial mutation queue (Sprint 7-8+)
│   ├── ws-client.ts            # WebSocket client (Sprint 7-8+)
│   ├── graphql.ts              # Shared fetch helper
│   └── utils.ts / issue-utils.ts
└── types/                      # Shared frontend type definitions (issues.ts)
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

| Convention | Example |
|------------|---------|
| UUID primary keys | `id String @id @default(uuid()) @db.Uuid` |
| Soft delete | `archivedAt DateTime? @map("archived_at") @db.Timestamptz` |
| Audit timestamps | `createdAt / updatedAt` on every model |
| snake_case DB mapping | `@map("url_key")`, `@@map("organizations")` |
| Timezone-aware datetimes | `@db.Timestamptz` (not `@db.Timestamp`) |

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

> **Known exception:** `Team.organization` in `resolvers/team.ts` calls `ctx.prisma.organization.findUnique` directly because `OrganizationService` does not yet exist. Once org-level business logic is added (Sprint 13+: member invitations, settings, billing), create `OrganizationService`, move this call into it, and add the service to `GraphQLContext`.

---

## 5. GraphQL Context Pattern

Context is built per-request from the incoming headers/cookies:

```typescript
// src/server/graphql/context.ts
export interface GraphQLContext extends AuthContext {
  prisma: PrismaClient;
  search: SearchService;     // Added Sprint 9-10: PostgreSQL full-text search
  services: {
    auth: AuthService;
    issue: IssueService;
    label: LabelService;
    sync: SyncService;       // Added Sprint 7-8: creates SyncActions + Redis broadcast
    team: TeamService;
    user: UserService;
    workflowState: WorkflowStateService;
  };
}

export async function createContext(req: NextRequest): Promise<GraphQLContext> {
  const auth = await extractAuthContext(
    req.headers.get('authorization'),
    req.cookies.get('access_token')?.value ?? null,
  );
  const userService = new UserService(prisma);
  const teamService = new TeamService(prisma);
  const workflowStateService = new WorkflowStateService(prisma);
  return {
    ...auth,
    prisma,
    search: new SearchService(prisma),
    services: {
      auth: new AuthService(prisma, userService),
      issue: new IssueService(prisma),
      label: new LabelService(prisma),
      team: teamService,
      user: userService,
      workflowState: workflowStateService,
    },
  };
}
```

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
