# Issue Tracker

A Linear-style issue tracker built with Next.js 16, GraphQL, and PostgreSQL. See `docs/IMPLEMENTATION_PLAN.md` for the full roadmap and `docs/PATTERNS.md` for established code patterns.

## Tech Stack

- **Next.js 16** (App Router) — framework, routing, API routes
- **Apollo Server** + GraphQL — server-only API layer (`/api/graphql`); frontend uses raw `fetch` — no Apollo Client
- **Prisma 7** + `@prisma/adapter-pg` — type-safe ORM (PostgreSQL driver adapter)
- **jose** — edge-compatible JWT (access tokens 24h, refresh tokens 30d)
- **ioredis** — Redis client (pub/sub for sync broadcast; required from Sprint 7-8 onwards)
- **MobX** + **mobx-react-lite** — observable state management (client-side entity pools)
- **Dexie.js** — IndexedDB wrapper for offline-first local cache
- **ws** — standalone WebSocket server process (port 3001) for real-time sync
- **next-themes** — dark/light/system theme switching (`ThemeProvider`, `.dark` class on `<html>`)
- **sonner** — toast notification library (wrapped via `src/lib/toast.ts`)
- **pino** + **pino-pretty** — structured JSON logging (server-side, pretty-printed in dev)
- **TipTap** — rich-text editor for issue descriptions, comments, and documents (mentions, slash commands, Mermaid, embeds, file uploads)
- **@sentry/nextjs** — error tracking (`sentry.{client,edge,server}.config.ts`)
- **TailwindCSS v4** + shadcn/ui — styling
- **Playwright** — E2E browser testing (`tests/e2e/`, `yarn test:e2e`)
- **Biome** — linting and formatting (replaces ESLint + Prettier)
- **Yarn v4** — package manager

## Prerequisites

- Node.js 24+
- Docker & Docker Compose (for local infrastructure via `yarn docker:infra:up`; both PostgreSQL and Redis are required)

## Getting Started

### 1. Install dependencies

```bash
yarn install
```

### 2. Start local infrastructure (PostgreSQL + Redis)

```bash
yarn docker:infra:up
```

This starts PostgreSQL on port `5432` and Redis on port `6379` using `docker-compose.infra.yml`.

### 3. Configure environment

```bash
cp .env.example .env
```

Edit `.env` and set at minimum:

```text
DATABASE_URL=postgresql://user:pass@localhost:5432/bilinear
REDIS_URL=redis://localhost:6379
JWT_SECRET=<random 256-bit hex>
JWT_REFRESH_SECRET=<different random 256-bit hex>
APP_URL=http://localhost:3000
```

Generate secrets with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 4. Generate the Prisma client

`src/generated/` is gitignored. Run this after every fresh checkout and after any schema change:

```bash
yarn prisma generate
```

### 5. Run database migrations

```bash
yarn prisma migrate dev
```

### 6. Start the development server and WebSocket server

In two separate terminals:

```bash
yarn dev         # Next.js app on port 3000
yarn ws:server   # Standalone WebSocket sync server on port 3001
```

Open [http://localhost:3000](http://localhost:3000). Unauthenticated visits redirect to `/login`.

In development, magic link codes are printed to the server console instead of being emailed — look for `[Email] Magic link for ...` in the terminal output.

---

## Scripts

| Command                      | Description                                            |
| ---------------------------- | ------------------------------------------------------ |
| `yarn dev`                   | Start the Next.js development server (port 3000)       |
| `yarn ws:server`             | Start the standalone WebSocket sync server (port 3001) |
| `yarn build`                 | Build for production                                   |
| `yarn start`                 | Start the production server                            |
| `yarn test`                  | Run all tests                                          |
| `yarn test:watch`            | Run tests in watch mode                                |
| `yarn test:coverage`         | Run tests with coverage report                         |
| `yarn lint`                  | Run Biome checks                                       |
| `yarn format`                | Format code with Biome                                 |
| `yarn docker:infra`          | Start local infra (foreground)                         |
| `yarn docker:infra:up`       | Start local infra in background                        |
| `yarn docker:infra:down`     | Stop local infra                                       |
| `yarn prisma generate`       | Regenerate Prisma client after schema changes          |
| `yarn prisma migrate dev`    | Apply pending migrations (dev)                         |
| `yarn prisma migrate deploy` | Apply pending migrations (production)                  |
| `yarn prisma studio`         | Open Prisma Studio (database browser)                  |
| `yarn db:seed`               | Seed the database with demo data and E2E test fixtures |
| `yarn test:e2e`              | Run Playwright E2E tests (requires running dev server) |
| `yarn test:e2e:ui`           | Open Playwright UI for interactive E2E debugging       |
| `yarn analyze`               | Build with bundle analyzer (`ANALYZE=true`)            |

---

## Project Structure

```text
src/
├── app/                      # Next.js App Router pages
│   ├── (auth)/               # Login + verify pages (centered, no sidebar)
│   ├── (workspace)/          # Authenticated pages (sidebar layout)
│   │   └── [workspace]/
│   │       ├── team/[key]/   # Team issues list view (reads from MobX stores)
│   │       └── issue/[id]/   # Standalone issue detail page
│   ├── api/graphql/          # GraphQL endpoint — Apollo Server
│   ├── api/auth/session/     # GET/POST/DELETE httpOnly cookie + session token
│   ├── api/sync/bootstrap/   # GET — full data snapshot (line-delimited stream)
│   └── api/sync/delta/       # GET — SyncActions since lastSyncId
├── server/                   # Backend-only code (never imported by client)
│   ├── graphql/              # schema.ts, context.ts, resolvers/, types/
│   ├── services/             # auth, user, organization, team, workflow-state, label, issue,
│   │                         # issue-activity, issue-relation, issue-template,
│   │                         # project, cycle, custom-view, custom-field,
│   │                         # comment, notification, document, file, roadmap,
│   │                         # triage, initiative, webhook,
│   │                         # search, sync (one class per domain)
│   ├── lib/                  # prisma, redis, jwt, email, logger (pino), tiptap-schema
│   ├── middleware/           # JWT extraction, requireAuth, requireOrgRole, requireTeamMember, rate limiter
│   └── ws/                   # Standalone WebSocket server (yarn ws:server)
│       ├── index.ts          # WS server entry point, Redis PubSub relay
│       └── connection-manager.ts  # Track connected clients per org
├── stores/                   # MobX observable stores
│   ├── root-store.ts         # RootStore aggregating all entity stores
│   ├── sync-store.ts         # lastSyncId, connection status
│   ├── ui-store.ts           # Sidebar collapsed, active team, selection
│   ├── issue-store.ts        # Issue pool + optimistic updates
│   ├── team-store.ts
│   ├── user-store.ts
│   ├── label-store.ts
│   ├── workflow-state-store.ts
│   ├── project-store.ts
│   ├── cycle-store.ts
│   ├── custom-view-store.ts
│   ├── custom-field-store.ts
│   ├── notification-store.ts
│   ├── issue-relation-store.ts
│   ├── issue-template-store.ts
│   ├── document-store.ts
│   ├── initiative-store.ts
│   └── triage-store.ts
├── providers/
│   ├── store-provider.tsx    # React context for MobX RootStore
│   └── sync-provider.tsx     # Bootstrap + WebSocket lifecycle
├── components/
│   ├── auth/                 # LoginForm, VerifyCodeForm
│   ├── layouts/              # AppShell, Sidebar, WorkspaceClient
│   ├── command-palette/      # Cmd+K modal (lazy-loaded)
│   ├── issues/               # IssueListView, IssueRow, IssueDetailPanel, CreateIssueModal, GroupSection, comments, file attachments
│   ├── views/                # Custom view pages, filter builder, column picker, CSV export
│   ├── properties/           # StatusSelect, PrioritySelect, AssigneeSelect, LabelSelect, ProjectSelect, CycleSelect, DueDatePicker
│   ├── cycles/               # Cycle list/detail, BurndownChart SVG, rollover action
│   ├── projects/             # Project list/detail, milestones, updates
│   ├── custom-fields/        # Team settings UI + detail panel value editors
│   ├── notifications/        # Notification bell + inbox list
│   ├── editor/               # TipTap extension set (mention, slash, mermaid, embed, details)
│   ├── documents/            # Document tree + editor
│   ├── roadmap/              # Public roadmap page + Workspace Settings config
│   ├── teams/                # Team member management, team settings
│   ├── ui/                   # shadcn/ui primitives + Skeleton components
│   ├── error-boundary.tsx    # ErrorBoundary class component + SectionError
│   └── theme-toggle.tsx      # Three-way light/dark/system toggle
├── hooks/                    # useAuth, useHotkeys, useChord, useRecentItems, useTheme
├── lib/
│   ├── db.ts                 # Dexie.js AppDatabase (IndexedDB schema + DB interfaces)
│   ├── sync-manager.ts       # Sync lifecycle: bootstrap → IndexedDB → MobX → WebSocket
│   ├── transaction-queue.ts  # Serial GraphQL mutation queue with retry/rollback
│   ├── ws-client.ts          # WebSocket client with exponential backoff reconnect
│   ├── csv-export.ts         # Flat-row exporter for the filtered issue list
│   ├── fuzzy-search.ts       # Local fuzzy match for store search
│   ├── toast.ts              # sonner wrapper (do not import sonner directly)
│   ├── graphql.ts            # Shared fetch helper for GraphQL mutations
│   ├── utils.ts
│   └── issue-utils.ts
└── types/                    # Shared frontend types (issues.ts, filter-composition.ts, ...)
```

See `docs/PATTERNS.md` for conventions used throughout the codebase.

---

## Deployment

This repo follows the workspace's standard docker-compose overlay set —
`docker-compose.{infra,app,prod,traefik,watchtower}.yml` at the repo root, built
and published via `.github/workflows/docker.yml` (GHCR + optional custom
registry). The image runs `prisma migrate deploy` on boot via
`docker-entrypoint.sh`, so a fresh container catches up on schema before serving
traffic.

```bash
# Local full-stack build (builds from source)
yarn docker:infra:up
docker compose -f docker-compose.app.yml -f docker-compose.infra.yml up --build

# Production (pulls the published image)
cp .env.example .env
docker compose -f docker-compose.prod.yml -f docker-compose.infra.yml up -d

# Behind Traefik (TLS, custom domain — set DOMAIN_APP first)
docker compose -f docker-compose.prod.yml -f docker-compose.infra.yml \
               -f docker-compose.traefik.yml up -d
```

Required environment variables (in addition to defaults): `JWT_SECRET`, `JWT_REFRESH_SECRET`, `APP_URL`, `REDIS_URL`, and optionally `POSTGRES_PASSWORD`, `WS_PORT` (default 3001), SMTP / Google OAuth settings. See `.env.example` for the full list.

### Production process requirements

Two long-running processes are required in production alongside the Next.js app:

| Process                     | Command           | Responsibilities                                                                                                 |
| --------------------------- | ----------------- | ---------------------------------------------------------------------------------------------------------------- |
| **WebSocket server**        | `yarn ws:server`  | Real-time sync fan-out (Redis Pub/Sub → connected clients), webhook retry sweep (every 30s), cycle auto-rollover |
| **YJS server** *(optional)* | `yarn yjs:server` | Collaborative editing — only needed when `NEXT_PUBLIC_COLLAB_ENABLED=true`                                       |

**Neither server is wired into the Docker Compose files** — run them as separate services or background processes in your deployment. Set `NEXT_PUBLIC_WS_PORT` (and `NEXT_PUBLIC_YJS_SERVER_URL` for YJS) before `yarn build` so the values are inlined at build time.

> **Warning:** The webhook retry sweep and cycle auto-rollover run exclusively inside the WS server process. If it is not running, scheduled webhooks will not be retried and cycles will not roll over automatically.

---

## Adding shadcn/ui Components

```bash
npx shadcn@latest add <component>
```

---

## Documentation

| Document                      | Description                                     |
| ----------------------------- | ----------------------------------------------- |
| `docs/PRD.md`                 | Product requirements                            |
| `docs/IMPLEMENTATION_PLAN.md` | Phase-by-phase roadmap                          |
| `docs/ARCHITECTURE.md`        | System architecture                             |
| `docs/DATABASE_SCHEMA.md`     | Full PostgreSQL schema                          |
| `docs/API_DESIGN.md`          | GraphQL API contracts                           |
| `docs/PATTERNS.md`            | Code patterns and conventions (read this first) |
| `docs/sprints/`               | Per-sprint implementation specs                 |
