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
| Build + bundle analyzer         | `yarn analyze`                                             |
| Lint                            | `yarn lint`                                                |
| Lint + fix                      | `yarn lint:fix`                                            |
| Design-token check              | `yarn lint:tokens`                                         |
| Format                          | `yarn format`                                              |
| Typecheck                       | `yarn typecheck`                                           |
| All unit tests                  | `yarn test`                                                |
| Single test file                | `yarn vitest run src/server/services/auth.service.test.ts` |
| Test watch mode                 | `yarn test:watch`                                          |
| Coverage                        | `yarn test:coverage`                                       |
| E2E tests                       | `yarn test:e2e` (needs dev + ws:server running)            |
| E2E with UI                     | `yarn test:e2e:ui`                                         |
| Generate Prisma client          | `yarn db:generate` (aka `yarn prisma generate`)            |
| Push schema to DB               | `yarn db:push`                                             |
| Run migrations (dev)            | `yarn db:migrate`                                          |
| Apply migrations (prod)         | `yarn db:deploy`                                           |
| Reset DB                        | `yarn db:reset`                                            |
| Seed DB                         | `yarn db:seed`                                             |
| Database browser                | `yarn db:studio`                                           |
| Verify xid8 delta fence         | `yarn db:verify:fence` (needs a live Postgres)             |
| Benchmark hot-path indexes      | `yarn db:verify:indexes` (needs a live Postgres)           |
| Grant platform admin            | `yarn admin:grant`                                         |
| Start infra (Postgres + Redis)  | `yarn docker:infra:up`                                     |

**The CI gate suite is `yarn lint`, `yarn lint:tokens`, `yarn typecheck`, `yarn test`, `yarn build`** (`.github/workflows/ci.yml`) — run all five before pushing.

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

### Database

- UUID PKs, soft delete via `archivedAt`, audit timestamps on all models
- snake_case DB columns (`@map`), timezone-aware datetimes (`@db.Timestamptz`)

### GraphQL

- Error discriminator: `extensions.code` (UNAUTHENTICATED, NOT_FOUND, INVALID_CODE, INVALID_TOKEN, FORBIDDEN, RATELIMITED, BAD_USER_INPUT)
- Mutations return `{ success, <entity>, lastSyncId }` — lastSyncId is a string (BIGSERIAL)
- SyncAction must be created for every mutation: `ctx.services.sync.createSyncAction(orgId, action, model, id, data)`

### MobX Stores

- Wrap components with `observer()` from `mobx-react-lite`
- Use `useStore()` hook (from StoreProvider context) to access RootStore — never import `getRootStore()` directly. No Redux/Zustand/React Query/SWR; use `useState` for ephemeral local UI state only.
- Use `store.pool.size` as dependency in `useMemo`, not the Map itself
- `TransactionQueue` instances share a singleton in-memory FIFO backed by an IndexedDB `pendingTransactions` table. `new TransactionQueue()` per component mount with `useMemo(() => new TransactionQueue(), [])` is still the convention — every instance enqueues into the shared queue. Pending transactions survive a page reload, scoped to the session that enqueued them (`orgId`/`userId` from the JWT). `SyncProvider` calls `TransactionQueue.setActiveSession(...)` then `TransactionQueue.hydrate(session)` once at app boot; rows from other sessions are deleted, not replayed.

### Auth

- Magic link email with 6-digit codes. Hash before store (`crypto.createHash('sha256')`). CSPRNG only (`crypto.randomInt`).
- JWT via `jose` (edge-compatible). Access tokens 24h, refresh tokens 30d in httpOnly cookies.
- `requireAuth(ctx)` uses TypeScript `asserts` narrowing.
- E2E test bypass: `NODE_ENV=test` + `TEST_AUTH_CODE=000000`

### Frontend

- TailwindCSS v4 + shadcn/ui only — no CSS Modules, no styled-components. Dark mode via `next-themes` (class-based); accent colour via the `accent` cookie + `data-accent` on `<html>` (see `src/lib/accent.ts`).
- **No raw colours at all.** `yarn lint:tokens` bans every shade-numbered Tailwind palette hue (`red-500`, `zinc-700`, `blue-400`, …) and every hex literal across `src/components`, `src/app`, `src/lib` and `src/hooks`, at a literal-zero baseline. Use the token families: surfaces (`bg-background`/`bg-card`/`bg-muted`/`bg-accent` for hover/`bg-surface-raised`/`bg-surface-sunken`), ink (`text-foreground`/`-secondary`/`text-muted-foreground`/`text-foreground-faint`), brand (`bg-brand`, `bg-brand-subtle`, `text-brand-subtle-foreground`, `border-brand-border`), status (`danger`/`success`/`warning`/`info`/`merged`, each with `-subtle` and `-subtle-foreground`), and elevation (`shadow-e1` rows, `shadow-e2` popovers, `shadow-e3` modals). A fixed palette that genuinely can't be a token (priority swatches, cursor colours, accent swatches) lives in `globals.css` and is referenced from `.ts` as a `var()` string, never inlined.
- **Brand roles follow the user's accent; status roles never do.** Status encodes data — "this failed" must mean the same thing under every accent. Tests in `src/lib/accent.test.ts` enforce both halves.
- Typography: `--font-sans` is Instrument Sans, `--font-mono` is Geist Mono, both vendored under `src/app/fonts` and loaded with `next/font/local` (never `next/font/google` — the build must not depend on a font CDN). Identifiers, counts, estimates and timestamps go in `font-mono tabular-nums`.
- Use `cn()` from `@/lib/utils` (clsx + tailwind-merge) for all class merging — never template-literal concatenation.
- Component files live in `src/components/<feature>/` — feature-grouped, kebab-case filenames. Interactive components are `'use client'`; pages and layouts are server components.
- Large client-only widgets use `dynamic(..., { ssr: false })` with a `.lazy.tsx` suffix (e.g. `tiptap-editor.lazy.tsx`, `issue-detail-panel.lazy.tsx`).
- Toast notifications: use `@/lib/toast` wrapper, never import sonner directly. It exposes `error/info/success/warning` plus `undo(message, label, onUndo)`, `loading`, `promise`, and `dismiss(id)`. `TransactionQueue` permanent failures with no per-call `onError` fall through to a default toast registered by `SyncProvider` — never rely on that as the primary UX for a known failure path.
- Logging: use `logger`/`childLogger` from `@/server/lib/logger` (pino). No `console.log` in server code.
- UI primitives in `src/components/ui/`: `Button` (CVA), `Badge` (CVA — shape via `variant`: `pill`/`square`, colour via `tone`: `brand`/`danger`/`info`/`muted`/`none`/`outline`/`success`/`warning`; **there is deliberately no `solid` variant** — it hardcoded `text-white` over caller-supplied status fills and failed contrast, so solid status chips are `tone` pills whose pairs `src/lib/contrast.test.ts` asserts), `UserAvatar`, `SimpleSelect` (from `ui/select`), `Skeleton` + `LoadingRegion`/`RowsSkeleton`/`PageSkeleton`/`IssueListSkeleton`/`IssueSkeleton`/`DetailPanelSkeleton`/`SidebarSkeleton` (from `ui/skeleton`), `SelectPopover`, `SearchableSelectPopover` (generic searchable dropdown — see `CycleSelect`/`ProjectSelect` for usage), `ModalDialog` + `ModalHeader`/`ModalFooter` (native `showModal()` — real focus trap; Escape arrives as the `cancel` event), `Input`, `Textarea`, `Switch`, `PageHeader`/`Toolbar` (the single page-chrome header + its control strip — never hand-roll a page header), `EmptyState`. Extend here, not inline — don't hand-roll form fields, toggles, page headers or empty states.
- Loading states shimmer **and** announce: a `Skeleton` is `aria-hidden`, so wrap it in `LoadingRegion` (`role="status"` + `aria-busy` + sr-only text). Never hand-roll an `animate-pulse` block. A pulsing *dot* is the exception — there a pulse means "live" (connection status, pending write), not "loading".
- `/design` renders the whole token layer and every primitive across all three accents and both themes. Open it when changing anything in `ui/` or `globals.css`; this repo's CI has no visual regression suite.
- Full design-system reference — the two colour families and why status never follows the accent, the two-values-per-accent derivation, the specificity trap, and the primitive inventory — is **PATTERNS.md §79**.
- Shared sub-components in `src/components/shared/`: `ConfirmDialog` (destructive confirmations — always prefer over `window.confirm`), `InlineRetry` (a failed fetch must offer a retry, never render as an authoritative empty state), `SettingToggleRow`, `SyncErrorState`, `UpdateFormFields`, `CreateUpdateForm`/`EditUpdateForm`, `DeleteUpdateButton`. Add cross-feature building blocks here.
- Fetch-on-mount goes through `useRetryableFetch` (`src/hooks/`) — it owns the `reloadKey`/cancelled-flag state machine and pairs with `InlineRetry`. Pass `{ silent: true }` for post-mutation background refreshes so they don't re-flash the skeleton. See PATTERNS.md §80.6.
- Escape contract: whichever surface consumes an Escape must claim it (`preventDefault` + `stopPropagation` — `useOutsideClick` does this for popovers, capture-phase). Window-level Escape listeners on parent surfaces must ignore handled events (`if (e.defaultPrevented) return`). One Escape closes exactly one surface.
- Issue mutations from components: use `useIssueCreate(team, states)` and `useIssueUpdate()` from `src/hooks/` — they own the optimistic apply, TransactionQueue enqueue, rollback, and failure toast. Map store models for issue components with `toIssueUsers`/`toIssueLabels` from `@/lib/issue-mappers`; don't hand-roll the mapping.
- Issue creation UI: there is exactly one create modal — `GlobalCreateIssueModal`, mounted in `WorkspaceClient` and driven by `uiStore.openCreateIssueModal()`. Open it from buttons/shortcuts/palette actions via the store; never mount a second `CreateIssueModal`.
- Dropdown/popover state: use `usePopover({ open?, forceOpen?, onClose?, closeOnEscape? })` from `@/hooks/use-popover` — returns `{ open, setOpen, ref }`. `open` is fully controlled (parent owns show/hide); `forceOpen` is a one-shot uncontrolled open. For outside-click only (no popover state), use `useOutsideClick` from `@/hooks/use-outside-click` directly — it also takes an optional `closeOnEscape` param.

### Testing

- Unit tests (Vitest): mock Prisma via `createMockPrisma()`, mock context via `createMockContext()`. Fixtures in `src/test/fixtures.ts`. If the subject emits a SyncAction, stub the write with `mockSyncActionInserts(prisma)` and assert with `readSyncActionInserts(prisma)` (`src/test/sync-action-mock.ts`) — `recordSyncAction` goes through a raw `INSERT … RETURNING`, not `prisma.syncAction.create`. Role-gated resolvers read `ctx.orgRole`, so express "caller lacks the role" there, not via a prisma mock.
- E2E tests (Playwright): `tests/e2e/`. Use `loginAs(page, email)` helper. Both dev server + WS server must be running.
- MockSyncService returns `{ id: BigInt(1) }` — assert `lastSyncId === '1'` (string).

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

`PATTERNS.md` is 2,800+ lines — read the section you need via its table of contents, not the whole file.
