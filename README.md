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
- **TailwindCSS v4** + shadcn/ui — styling
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

This starts PostgreSQL on port `5432` and Redis on port `6379` using `docker-compose.infra.yaml`.

### 3. Configure environment

```bash
cp .env.example .env
```

Edit `.env` and set at minimum:

```text
DATABASE_URL=postgresql://user:pass@localhost:5432/issue_tracker
REDIS_URL=redis://localhost:6379
JWT_SECRET=<random 256-bit hex>
JWT_REFRESH_SECRET=<different random 256-bit hex>
APP_URL=http://localhost:3000
```

Generate secrets with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 3. Generate the Prisma client

`src/generated/` is gitignored. Run this after every fresh checkout and after any schema change:

```bash
yarn prisma generate
```

### 4. Run database migrations

```bash
yarn prisma migrate dev
```

### 5. Start the development server and WebSocket server

In two separate terminals:

```bash
yarn dev         # Next.js app on port 3000
yarn ws:server   # Standalone WebSocket sync server on port 3001
```

Open [http://localhost:3000](http://localhost:3000). Unauthenticated visits redirect to `/login`.

In development, magic link codes are printed to the server console instead of being emailed — look for `[Email] Magic link for ...` in the terminal output.

---

## Scripts

| Command                      | Description                                               |
| ---------------------------- | --------------------------------------------------------- |
| `yarn dev`                   | Start the Next.js development server (port 3000)          |
| `yarn ws:server`             | Start the standalone WebSocket sync server (port 3001)    |
| `yarn build`                 | Build for production                                      |
| `yarn start`                 | Start the production server                               |
| `yarn test`                  | Run all tests                                             |
| `yarn test:watch`            | Run tests in watch mode                                   |
| `yarn test:coverage`         | Run tests with coverage report                            |
| `yarn lint`                  | Run Biome checks                                          |
| `yarn format`                | Format code with Biome                                    |
| `yarn docker:infra`          | Start local infra (foreground)                            |
| `yarn docker:infra:up`       | Start local infra in background                           |
| `yarn docker:infra:down`     | Stop local infra                                          |
| `yarn prisma generate`       | Regenerate Prisma client after schema changes             |
| `yarn prisma migrate dev`    | Apply pending migrations (dev)                            |
| `yarn prisma migrate deploy` | Apply pending migrations (production)                     |
| `yarn prisma studio`         | Open Prisma Studio (database browser)                     |

---

## Project Structure

```
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
│   ├── services/             # AuthService, UserService, TeamService,
│   │                         # WorkflowStateService, IssueService, LabelService,
│   │                         # SyncService (SyncAction creation + Redis broadcast)
│   ├── lib/                  # prisma.ts, redis.ts, jwt.ts, email.ts
│   ├── middleware/           # JWT extraction, requireAuth, requireOrgRole, requireTeamMember
│   └── ws/                   # Standalone WebSocket server (yarn ws:server)
│       ├── index.ts          # WS server entry point, Redis PubSub relay
│       └── connection-manager.ts  # Track connected clients per org
├── stores/                   # MobX observable stores
│   ├── root-store.ts         # RootStore aggregating all entity stores
│   ├── sync-store.ts         # lastSyncId, connection status
│   ├── issue-store.ts        # Issue pool + optimisticUpdate
│   ├── team-store.ts         # Team pool
│   ├── user-store.ts         # User pool + currentUserId
│   ├── label-store.ts        # IssueLabel pool
│   ├── workflow-state-store.ts
│   └── ui-store.ts           # Sidebar collapsed, active team, selection
├── providers/
│   ├── store-provider.tsx    # React context for MobX RootStore
│   └── sync-provider.tsx     # Bootstrap + WebSocket lifecycle
├── components/
│   ├── auth/                 # LoginForm, VerifyCodeForm
│   ├── issues/               # IssueListView, IssueRow, IssueDetailPanel, CreateIssueModal, GroupSection
│   ├── layouts/              # AppShell, Sidebar
│   ├── properties/           # StatusSelect, PrioritySelect, AssigneeSelect, LabelSelect, DueDatePicker
│   └── ui/                   # shadcn/ui primitives
├── hooks/                    # useAuth, useHotkeys
├── lib/
│   ├── db.ts                 # Dexie.js AppDatabase (IndexedDB schema + DB interfaces)
│   ├── sync-manager.ts       # Sync lifecycle: bootstrap → IndexedDB → MobX → WebSocket
│   ├── transaction-queue.ts  # Serial GraphQL mutation queue with retry/rollback
│   ├── ws-client.ts          # WebSocket client with exponential backoff reconnect
│   ├── graphql.ts            # Shared fetch helper for GraphQL mutations
│   ├── utils.ts
│   └── issue-utils.ts
└── types/                    # issues.ts (shared frontend types: WorkflowState, IssueUser, etc.)
```

See `docs/PATTERNS.md` for conventions used throughout the codebase.

---

## Deployment

The `deployment/` directory contains a production Docker Compose setup that builds and runs the full stack (app, PostgreSQL, Redis).

```bash
cd deployment
# Copy and fill in environment variables
cp ../.env.example .env
# Build and start all services (runs migrations automatically)
docker compose up -d
```

Required environment variables (in addition to defaults): `JWT_SECRET`, `JWT_REFRESH_SECRET`, `APP_URL`, `REDIS_URL`, and optionally `POSTGRES_PASSWORD`, `WS_PORT` (default 3001), SMTP / Google OAuth settings.

The WebSocket server (`yarn ws:server`) runs as a separate process. In production, run it alongside the Next.js app and ensure `NEXT_PUBLIC_WS_PORT` is set if the WS server is on a non-default port.

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
