# Project Guidelines

This file provides guidance to AI Agents when working with code in this repository.

## Project Overview

A Linear-style issue tracker built with Next.js 16 (App Router), Apollo Server GraphQL, Prisma 7, PostgreSQL, MobX, and real-time sync via WebSocket + Redis Pub/Sub. Offline-first with Dexie.js (IndexedDB) client cache.

### Recently shipped (2026-05-05)

- **Triage workflow** — inbound issue queue at `/team/[key]/triage` with accept/decline/snooze/duplicate. Issues created on triage-enabled teams default to a `triage`-type workflow state. See PATTERNS.md §38.
- **Initiatives** — top-level strategic objects above projects, m:n with `Project`. Progress rolls up from linked projects. UI at `/initiatives`. See PATTERNS.md §39.
- **Webhooks** — outbound HMAC-signed HTTP subscriptions, admin-only at `/settings/webhooks`. Retry sweep runs in the WS server every 30s. See PATTERNS.md §40 and DATABASE_SCHEMA.md §2.21.

### Quick-wins batch (2026-05-21)

- **Issue snooze** — `issueSnooze(id, until)` / `issueUnsnooze(id)` mutations finally expose the existing `snoozed_until_at` / `snoozed_by_id` columns. Wakeup is read-time (no background worker). See PATTERNS.md §49.
- **Bulk issue update** — `issuesBulkUpdate(ids, input)` mutation applies the same patch to up to 200 issues atomically. Auto-close cascades intentionally skipped; cross-team state changes rejected. See PATTERNS.md §50.
- **Guest role enforcement (read path)** — `requireTeamMemberNotGuest` + `isTeamGuest` helpers in `src/server/middleware/auth.ts`. The `issues` query now scopes guests to creator-or-assignee via a server-derived `IssueFilter.guestUserId`. Write-path sweep completed 2026-05-24. See PATTERNS.md §48.
- **Workspace-level custom fields** — `CustomFieldDefinition.teamId` is nullable; null = workspace-scoped. Per-org cap of 30 active workspace fields; owner/admin-only create/edit. New `workspaceCustomFieldDefinitions` query. See DATABASE_SCHEMA.md §2.27.
- **Favorites** — new `favorites` table, `FavoriteService`, `Favorite.entity` GraphQL union over Issue/Project/Initiative/CustomView/Cycle/Document/Team. Cross-org or deleted targets resolve to `null` (sidebar skips). Sidebar UI implemented in `src/components/layouts/sidebar.tsx`. See PATTERNS.md §47 and DATABASE_SCHEMA.md §2.18.
- **Sub-initiatives** — `Initiative.parentId` self-FK with max depth 5, cycle detection, cross-org rejection. Progress rollup averages projects AND children, propagates one level up the parent chain. See PATTERNS.md §46 and DATABASE_SCHEMA.md §2.32.

### Tier 5 completions (2026-05-24)

- **Duplicate relation auto-cancel** — `IssueRelationService.create()` returns `{ relation, canceledIssue, canceledIssueOldStateId }` captured inside the transaction. Resolver triggers the `autoCloseParentIssues` cascade via `IssueService.update` and emits the activity log entry using the pre-cancel `stateId`. See PATTERNS.md §58.
- **Label group enforcement** — `LabelService.create()` and `update()` wrapped in `$transaction`; both enforce max-1-deep nesting and a 250-child cap atomically. `IssueService.syncLabels` calls the private `enforceSingleSelectPerGroup` helper before writing label assignments (last-writer-wins on group siblings). See PATTERNS.md §57.
- **Activity log accuracy** — `issueUpdate` resolver re-fetches labels via `getLabels()` after the write so the `labelAdded`/`labelRemoved` diff reflects the actual persisted set. `commentResolve`/`commentUnresolve` now emit `commentResolved`/`commentUnresolved` activity entries.
- **Guest write-path sweep** — `requireIssueAccessNotGuestOrOwn` guard applied to `commentCreate`, `issueRelationCreate`, and `issueRelationDelete`. Write-path enforcement is now complete. See PATTERNS.md §48.
- **Project `~`-mentions in TipTap** — `mentionProjects` prop on `TipTapEditor`; `buildProjectMentionExtension` backed by a Suggestion dropdown; `~` triggers it. See PATTERNS.md §56.
- **iCal cycle feed** — `calendar_feed_token VARCHAR(64) UNIQUE` on `users`; `userCalendarFeedTokenRotate` mutation; route `/api/cycles/feed/[token].ics` returns RFC 5545 iCal with `DTEND` equal to the exclusive `endsAt`. See PATTERNS.md §59.
- **Initiative health** — `Initiative.health: String!` GraphQL resolver derives health from the latest `InitiativeUpdate` within 30 days, falling back to a progress heuristic (`'onTrack'` / `'atRisk'` / `'offTrack'` / `'unknown'`). No DB column; no UI component yet. See PATTERNS.md §60.
- **GitHub `previousIdentifiers` fallback** — `GithubService.linkPullRequest()` finds issues via `identifier IN [...] OR previousIdentifiers hasSome [...]`, so renamed issues are still linked.

### Feature drop (2026-05-18)

- **Issue reactions** — normalized `IssueReaction` table (mirrors `CommentReaction`, unique on `(issueId, userId, emoji)`). Mutations `issueReactionAdd`/`issueReactionRemove`, `Issue.reactions` field, and an `IssueReactionBar` slotted under the title in `IssueDetailPanel`. Fetch-on-mount — not yet in the sync/bootstrap path. See DATABASE_SCHEMA.md §2.30 and PATTERNS.md §42.
- **Initiative updates** — `InitiativeUpdate` table mirroring `ProjectUpdate` (body, bodyData, health, soft-delete via `archivedAt`). CRUD via `initiativeUpdateCreate/Update/Delete`, `Initiative.updates` field, and an `InitiativeUpdatesSection` rendered inside the expanded initiative row. Author-only edit/delete enforced in the resolver; delete emits `'D'` SyncAction (not `'A'`) to match ProjectUpdate convention. See DATABASE_SCHEMA.md §2.31 and PATTERNS.md §43.
- **Project progress history** — no schema changes. `ProjectService.recordProgressSnapshotIfStale()` lazily stamps the four existing JSONB history columns once per UTC day on read; the GraphQL `Project.progressHistory` field merges the arrays into per-day rows. `ProgressSparkline` renders the completion ratio next to the progress bar.
- **Image paste in editor** — `TipTapEditor` now accepts `uploadIssueId` / `uploadProjectId`; paste & drop POST to `/api/upload` when a parent is supplied (otherwise fall back to base64 inline so files don't end up orphaned and 404). Props threaded from `IssueDetailPanel` and `CommentComposer`.

### Feature drop (2026-05-17)

- **GitHub integration** — OAuth connect/disconnect at `/settings/integrations`. Incoming webhooks at `/api/integrations/github/webhook?org=<urlKey>` auto-link PRs to issues by identifier regex and auto-close issues on PR merge. See PATTERNS.md §41 and DATABASE_SCHEMA.md §2.29.
- **Email notifications** — `NotificationService` now fires transactional emails (assignment, mention, comment, status change) via nodemailer. Per-user opt-out via `User.emailNotificationsEnabled`; toggled through `userUpdateNotificationPreferences` mutation. See PATTERNS.md §35.

### Hardening pass (2026-05-12)

- **WebSocket auth** — replaced the JWT-leaking `/api/auth/session` GET with `/api/auth/ws-ticket`. The long-lived access token never reaches client JavaScript; instead a scoped 60s `ws_ticket` JWT is issued per (re)connect. `WsClient.connect()` no longer takes a token — it fetches its own. See PATTERNS.md §18.
- **SyncAction commit watermark** — `sync_actions` gained a `committed_at` column populated by a BEFORE INSERT trigger. Delta-sync now orders by `(committed_at, id)` and ignores rows newer than 500ms so an earlier-id-but-later-commit row can't be silently skipped. See DATABASE_SCHEMA.md §2.22.
- **Tenant guards** — `requireTeamMember` / `requireTeamOwner` now take an explicit `orgId` and verify the team belongs to it. `Issue.findByIdentifier`, `Initiative.update/archive/delete/findById`, `Webhook.update/archive/delete/rotateSecret/findById/listDeliveries` were all rescoped to require `orgId`. Auto-close cascade now runs in the same transaction as the parent update AND emits per-row SyncActions.
- **Webhook concurrency** — `processDelivery` claims rows by transitioning `pending → in_flight` atomically; stale `in_flight` rows are reclaimed by the sweep after the claim deadline elapses. No more double deliveries on concurrent runners.
- **CSRF + per-IP caps** — Apollo `csrfPrevention: true` and an Origin allow-list now gate `/api/graphql`. Magic-link verify has a per-IP cap to match the per-email cap. The client-IP fallback works without `TRUST_PROXY_HEADERS=1`.

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
| Generate Prisma client         | `yarn db:generate` (aka `yarn prisma generate`)            |
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
- Use `useStore()` hook (from StoreProvider context) to access RootStore — never import `getRootStore()` directly. No Redux/Zustand/React Query/SWR; use `useState` for ephemeral local UI state only.
- Use `store.pool.size` as dependency in `useMemo`, not the Map itself
- `TransactionQueue` instances share a singleton in-memory FIFO backed by an IndexedDB `pendingTransactions` table. `new TransactionQueue()` per component mount with `useMemo(() => new TransactionQueue(), [])` is still the convention — every instance enqueues into the shared queue. Pending transactions survive a page reload, scoped to the session that enqueued them (`orgId`/`userId` from the JWT). `SyncProvider` calls `TransactionQueue.setActiveSession(...)` then `TransactionQueue.hydrate(session)` once at app boot; rows from other sessions are deleted, not replayed.

### Auth

- Magic link email with 6-digit codes. Hash before store (`crypto.createHash('sha256')`). CSPRNG only (`crypto.randomInt`).
- JWT via `jose` (edge-compatible). Access tokens 24h, refresh tokens 30d in httpOnly cookies.
- `requireAuth(ctx)` uses TypeScript `asserts` narrowing.
- E2E test bypass: `NODE_ENV=test` + `TEST_AUTH_CODE=000000`

### Frontend

- TailwindCSS v4 + shadcn/ui only — no CSS Modules, no styled-components. Dark mode via `next-themes` (class-based).
- No hardcoded hex colors — use Tailwind semantic tokens or CSS custom properties (oklch theme tokens).
- Use `cn()` from `@/lib/utils` (clsx + tailwind-merge) for all class merging — never template-literal concatenation.
- Component files live in `src/components/<feature>/` — feature-grouped, kebab-case filenames. Interactive components are `'use client'`; pages and layouts are server components.
- Large client-only widgets use `dynamic(..., { ssr: false })` with a `.lazy.tsx` suffix (e.g. `tiptap-editor.lazy.tsx`, `issue-detail-panel.lazy.tsx`).
- Toast notifications: use `@/lib/toast` wrapper, never import sonner directly.
- Logging: use `logger`/`childLogger` from `@/server/lib/logger` (pino). No `console.log` in server code.
- UI primitives in `src/components/ui/`: `Button` (CVA), `Badge` (CVA, variants: `pill`/`solid`), `UserAvatar`, `Select`, `Skeleton`, `SelectPopover`, `SearchableSelectPopover` (generic searchable dropdown — see `CycleSelect`/`ProjectSelect` for usage). Extend here, not inline.
- Shared sub-components in `src/components/shared/`: `UpdateFormFields`, `DeleteUpdateButton`. Add cross-feature building blocks here.
- Dropdown/popover state: use `usePopover({ open?, forceOpen?, onClose?, closeOnEscape? })` from `@/hooks/use-popover` — returns `{ open, setOpen, ref }`. `open` is fully controlled (parent owns show/hide); `forceOpen` is a one-shot uncontrolled open. For outside-click only (no popover state), use `useOutsideClick` from `@/hooks/use-outside-click` directly — it also takes an optional `closeOnEscape` param.

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
