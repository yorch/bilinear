# Project Guidelines

This file provides guidance to AI Agents when working with code in this repository.

## Project Overview

A Linear-style issue tracker built with Next.js 16 (App Router), Apollo Server GraphQL, Prisma 7, PostgreSQL, MobX, and real-time sync via WebSocket + Redis Pub/Sub. Offline-first with Dexie.js (IndexedDB) client cache.

### Recently shipped (2026-05-05)

- **Triage workflow** — inbound issue queue at `/team/[key]/triage` with accept/decline/snooze/duplicate. Issues created on triage-enabled teams default to a `triage`-type workflow state. See PATTERNS.md §38.
- **Initiatives** — top-level strategic objects above projects, m:n with `Project`. Progress rolls up from linked projects. UI at `/initiatives`. See PATTERNS.md §39.
- **Webhooks** — outbound HMAC-signed HTTP subscriptions, admin-only at `/settings/webhooks`. Retry sweep runs in the WS server every 30s. See PATTERNS.md §40 and DATABASE_SCHEMA.md §2.21.

## Commands

| Task                           | Command                                                    |
| ------------------------------ | ---------------------------------------------------------- |
| Dev server (Next.js)           | `yarn dev`                                                 |
| WebSocket server               | `yarn ws:server`                                           |
| Build                          | `yarn build`                                               |
| Lint                           | `yarn lint`                                                |
| Lint + fix                     | `yarn lint:fix`                                            |
| Format                         | `yarn format`                                              |
| Typecheck                      | `yarn typecheck`                                           |
| All unit tests                 | `yarn test`                                                |
| Single test file               | `yarn vitest run src/server/services/auth.service.test.ts` |
| Test watch mode                | `yarn test:watch`                                          |
| Coverage                       | `yarn test:coverage`                                       |
| E2E tests                      | `yarn test:e2e` (needs both dev + ws:server running)       |
| E2E with UI                    | `yarn test:e2e:ui`                                         |
| Generate Prisma client         | `yarn db:generate`                                         |
| Push schema to DB              | `yarn db:push`                                             |
| Run migrations                 | `yarn db:migrate`                                          |
| Reset DB                       | `yarn db:reset`                                            |
| Seed DB                        | `yarn db:seed`                                             |
| Start infra (Postgres + Redis) | `yarn docker:infra:up`                                     |

**Dev requires both** `yarn dev` (port 3000) and `yarn ws:server` (port 3001) running.

## Architecture

### Request Flow

```
Client (MobX stores) → GraphQL mutation via fetch (no Apollo Client)
  → /api/graphql (Apollo Server) → Resolver (auth + delegation) → Service (business logic) → Prisma → PostgreSQL
  → SyncAction created → Redis Pub/Sub → WebSocket server → all org clients
```

### Key Boundaries

- **`src/server/`** — backend only, never imported by client code. Contains GraphQL resolvers, services, middleware, and lib singletons.
- **`src/stores/`** — MobX observable entity pools. Components read from stores, not GraphQL queries.
- **`src/lib/`** — client-side utilities (sync-manager, transaction-queue, ws-client, Dexie DB).
- **`src/components/`** — React components, feature-grouped. `ui/` has shadcn/ui primitives.

### Data Flow (Client)

1. **Bootstrap:** `/api/sync/bootstrap` → IndexedDB (Dexie) → MobX stores
2. **Writes:** Optimistic MobX update → `TransactionQueue` enqueues GraphQL mutation → rollback on error
3. **Real-time:** WebSocket receives SyncActions → MobX stores updated → components re-render via `observer()`
4. **Delta sync:** `/api/sync/delta` catches up missed changes via `lastSyncId`

### Resolver → Service Pattern

Resolvers are thin: `requireAuth(ctx)` → `ctx.services.<domain>.method()` → return result with `lastSyncId`. All business logic lives in services. Services return plain objects, never GraphQL types. Error classes are internal to each service; resolvers catch and remap to `GraphQLError` with `extensions.code`.

### Prisma 7 Split Config

- **CLI** (`migrate`, `generate`): uses `prisma.config.ts` with `defineConfig({ datasource: { url } })`
- **Runtime**: uses `@prisma/adapter-pg` in `src/server/lib/prisma.ts`
- **Generated client**: `src/generated/prisma/` (gitignored — run `yarn db:generate` after checkout or schema changes)

## Key Conventions

### Database

- UUID PKs, soft delete via `archivedAt`, audit timestamps on all models
- snake_case DB columns (`@map`), timezone-aware datetimes (`@db.Timestamptz`)

### GraphQL

- Error discriminator: `extensions.code` (UNAUTHENTICATED, NOT_FOUND, INVALID_CODE, INVALID_TOKEN, FORBIDDEN, RATELIMITED, BAD_USER_INPUT)
- Mutations return `{ success, <entity>, lastSyncId }` — lastSyncId is a string (BIGSERIAL)
- SyncAction must be created for every mutation: `ctx.services.sync.createSyncAction(orgId, action, model, id, data)`

### MobX Stores

- Wrap components with `observer()` from `mobx-react-lite`
- Use `useStore()` hook (from StoreProvider context) to access RootStore — never import `getRootStore()` directly
- Use `store.pool.size` as dependency in `useMemo`, not the Map itself
- `TransactionQueue` instances share a singleton in-memory FIFO backed by an IndexedDB `pendingTransactions` table. `new TransactionQueue()` per component mount with `useMemo(() => new TransactionQueue(), [])` is still the convention — every instance enqueues into the shared queue. Pending transactions survive a page reload; `TransactionQueue.hydrate()` runs once at app boot from `SyncProvider` to replay them.

### Auth

- Magic link email with 6-digit codes. Hash before store (`crypto.createHash('sha256')`). CSPRNG only (`crypto.randomInt`).
- JWT via `jose` (edge-compatible). Access tokens 24h, refresh tokens 30d in httpOnly cookies.
- `requireAuth(ctx)` uses TypeScript `asserts` narrowing.
- E2E test bypass: `NODE_ENV=test` + `TEST_AUTH_CODE=000000`

### Frontend

- TailwindCSS v4 + shadcn/ui. Dark mode via `next-themes` (class-based).
- No hardcoded hex colors — use Tailwind semantic tokens or CSS custom properties.
- Toast notifications: use `@/lib/toast` wrapper, never import sonner directly.
- Lazy-load large components: `CommandPalette` (on Cmd+K), `IssueDetailPanel` (on first open).
- Logging: use `logger`/`childLogger` from `@/server/lib/logger` (pino). No `console.log` in server code.

### Testing

- Unit tests (Vitest): mock Prisma via `createMockPrisma()`, mock context via `createMockContext()`. Fixtures in `src/test/fixtures.ts`.
- E2E tests (Playwright): `tests/e2e/`. Use `loginAs(page, email)` helper. Both dev server + WS server must be running.
- MockSyncService returns `{ id: BigInt(1) }` — assert `lastSyncId === '1'` (string).

### Formatting

- Biome (not ESLint/Prettier): single quotes, arrow parens as-needed, block statements required, sorted imports, sorted object keys.
- Path alias: `@/*` → `src/*`

## Environment Variables

Copy `.env.example`. Required: `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, `APP_URL`. See `.env.example` for full list.

## Documentation

Detailed docs live in `docs/`: `PATTERNS.md` (primary conventions reference), `ARCHITECTURE.md`, `DATABASE_SCHEMA.md`, `API_DESIGN.md`, `PRD.md`, `IMPLEMENTATION_PLAN.md`.
