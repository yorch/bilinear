# Project Guidelines

This file provides guidance to AI Agents when working with code in this repository.

## Project Overview

A Linear-style issue tracker built with Next.js 16 (App Router), Apollo Server GraphQL, Prisma 7, PostgreSQL, MobX, and real-time sync via WebSocket + Redis Pub/Sub. Offline-first with Dexie.js (IndexedDB) client cache.

### Recent work

Change history — what shipped, and the reasoning behind each decision — lives in
[`docs/CHANGELOG.md`](docs/CHANGELOG.md), newest first. Read the top few entries
when you need to know why something is the way it is; open findings and the
current work queue are in [`docs/REVIEW_BACKLOG.md`](docs/REVIEW_BACKLOG.md).


## Commands

| Task                            | Command                                                    |
| ------------------------------- | ---------------------------------------------------------- |
| Dev server (Next.js)            | `yarn dev`                                                 |
| WebSocket sync server           | `yarn ws:server`                                           |
| Yjs collab-editing server       | `yarn yjs:server`                                          |
| Build                           | `yarn build`                                               |
| Start production server         | `yarn start`                                               |
| Build + bundle analyzer         | `yarn analyze`                                             |
| Lint                            | `yarn lint`                                                |
| Lint + fix                      | `yarn lint:fix`                                            |
| Design-token check              | `yarn lint:tokens`                                         |
| Re-baseline design tokens       | `yarn lint:tokens:update`                                  |
| Format                          | `yarn format`                                              |
| Typecheck                       | `yarn typecheck`                                           |
| All unit tests                  | `yarn test`                                                |
| Single test file                | `yarn vitest run src/server/services/auth.service.test.ts` |
| Test watch mode                 | `yarn test:watch`                                          |
| Coverage                        | `yarn test:coverage`                                       |
| E2E tests                       | `yarn test:e2e` (starts dev + ws itself; needs Postgres + Redis) |
| E2E with UI                     | `yarn test:e2e:ui`                                         |
| Generate Prisma client          | `yarn db:generate` (aka `yarn prisma generate`)            |
| Push schema to DB               | `yarn db:push`                                             |
| Run migrations (dev)            | `yarn db:migrate`                                          |
| Apply migrations (prod)         | `yarn db:deploy`                                           |
| Reset DB                        | `yarn db:reset`                                            |
| Seed DB                         | `yarn db:seed`                                             |
| Database browser                | `yarn db:studio`                                           |
| Verify xid8 delta fence         | `yarn db:verify:fence` (needs a live Postgres)             |
| Verify config layering          | `yarn db:verify:config` (needs a live Postgres)            |
| Benchmark hot-path indexes      | `yarn db:verify:indexes` (needs a live Postgres)           |
| Verify custom migration applied | `yarn db:verify:schema` (needs a live Postgres)            |
| Grant platform admin            | `yarn admin:grant`                                         |
| Start infra (Postgres/Redis/Mailpit) | `yarn docker:infra:up`                                |
| Start infra (foreground)        | `yarn docker:infra`                                        |
| Stop infra                      | `yarn docker:infra:down`                                   |
| Start infra via Just            | `just infra-up`                                            |
| Start local Docker stack        | `just dev-up`                                              |
| Start production stack          | `just prod-up`                                             |
| Deploy with Traefik + Watchtower | `just prod-full-up`                                       |

**The CI gate suite is `yarn lint`, `yarn lint:tokens`, `yarn typecheck`, `yarn test`, `yarn build`** (`.github/workflows/ci.yml`) — run all five before pushing.

Local mail goes to Mailpit — SMTP on 1025, inbox at http://localhost:8025. Magic-link codes are also printed to the dev server console.

**Dev needs three processes:** `yarn dev` (port 3000), `yarn ws:server` (port 3001, sync), and `yarn yjs:server` (port 1234, collaborative editing). The app boots without the Yjs server, but every TipTap editor silently stops syncing — set `NEXT_PUBLIC_YJS_SERVER_URL` if you move it off the default port.

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

### Where the detailed conventions live

Path-scoped rules in `.claude/rules/` load automatically when you touch the
matching files, so they are not repeated here:

| Rule                        | Loads for                                              |
| --------------------------- | ------------------------------------------------------ |
| `.claude/rules/frontend.md` | `src/components/**`, `src/app/**`, `src/hooks/**`, `src/stores/**` |
| `.claude/rules/server.md`   | `src/server/**`, `prisma/**`, `src/app/api/**`         |
| `.claude/rules/testing.md`  | `**/*.test.ts(x)`, `tests/**`, `src/test/**`           |

Read the matching rule before writing code in that area — especially when
creating a new file, where nothing existing has been read to trigger the load.

### Invariants that apply everywhere

These are the ones that cause silent breakage when missed, so they stay here:

- **Every mutation creates a SyncAction.** A row written without one is invisible
  to every other client until something coincidentally re-touches it.
- **No raw colours, anywhere.** No shade-numbered Tailwind hues (`red-500`,
  `zinc-700`), no hex literals. `yarn lint:tokens` enforces a literal-zero
  baseline and is a CI gate. Brand roles follow the user's accent; status roles
  never do.
- **Never hand-roll a primitive** that `src/components/ui/` or
  `src/components/shared/` already provides — page headers, form fields,
  toggles, empty states, confirm dialogs, skeletons, popovers.
- **Components read from MobX stores, not from GraphQL queries.** Wrap them in
  `observer()`. No Redux/Zustand/React Query/SWR.
- **A test that cannot fail is not a test.** Verify each new assertion is
  non-vacuous by regressing what it guards.
- **No `console.log` in server code** — use `logger`/`childLogger` from
  `@/server/lib/logger`.
- **Configuration goes in the registry, and a registered knob must have a
  consumer.** Anything that changes behaviour without changing user data is one
  `defineSetting` entry in `src/lib/config/registry.ts`, read through
  `ConfigService` — not a new column, and not a fresh `process.env` read. A knob
  nothing enforces is worse than no knob: it reports a setting that does
  nothing. Secrets, boot-time values and the security guards are deliberately
  `storage: 'env-only'`. See `docs/CONFIG_ASSESSMENT.md`.

### Formatting

- Biome (not ESLint/Prettier): single quotes, arrow parens as-needed, block statements required, sorted imports, sorted object keys.
- Path alias: `@/*` → `src/*`

## Environment Variables

Copy `.env.example`. Required: `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, `APP_URL`. See `.env.example` for full list.

## Documentation

`docs/README.md` is the index. The ones you'll want most:

| Doc                            | Use it for                                                              |
| ------------------------------ | ----------------------------------------------------------------------- |
| `docs/PATTERNS.md`             | **Primary conventions reference** — 80 sections, start from its TOC      |
| `docs/ARCHITECTURE.md`         | System architecture                                                     |
| `docs/DATABASE_SCHEMA.md`      | Schema, migration policy, the real-Postgres verification recipe         |
| `docs/API_DESIGN.md`           | GraphQL contracts                                                       |
| `docs/REVIEW_BACKLOG.md`       | **The active work queue** — open findings, what's shipped, what's deferred |
| `docs/CHANGELOG.md`            | What shipped when, and why it was done that way                         |
| `docs/IMPLEMENTATION_PLAN.md`  | Canonical per-sprint status                                             |

`PATTERNS.md` is 3,000+ lines — read the section you need via its table of
contents, not the whole file.
