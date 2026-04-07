# Issue Tracker

A Linear-style issue tracker built with Next.js 16, GraphQL, and PostgreSQL. See `docs/IMPLEMENTATION_PLAN.md` for the full roadmap and `docs/PATTERNS.md` for established code patterns.

## Tech Stack

- **Next.js 16** (App Router) — framework, routing, API routes
- **Apollo Server** + GraphQL — API layer (`/api/graphql`)
- **Prisma 7** + `@prisma/adapter-pg` — type-safe ORM (PostgreSQL driver adapter)
- **jose** — edge-compatible JWT (access tokens 24h, refresh tokens 30d)
- **ioredis** — Redis client (pub/sub, caching)
- **TailwindCSS v4** + shadcn/ui — styling
- **Biome** — linting and formatting (replaces ESLint + Prettier)
- **Yarn v4** — package manager

## Prerequisites

- Node.js 24+
- Docker & Docker Compose (for local infrastructure)

## Getting Started

### 1. Install dependencies

```bash
yarn install
```

### 2. Start local infrastructure (PostgreSQL + Redis)

```bash
yarn db:infra:up
```

This starts PostgreSQL on port `5432` and Redis on port `6379` using `docker-compose.infra.yaml`.

### 3. Configure environment

```bash
cp .env.example .env
```

Edit `.env` and set at minimum:

```
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

### 5. Start the development server

```bash
yarn dev
```

Open [http://localhost:3000](http://localhost:3000). Unauthenticated visits redirect to `/login`.

In development, magic link codes are printed to the server console instead of being emailed — look for `[Email] Magic link for ...` in the terminal output.

---

## Scripts

| Command | Description |
|---------|-------------|
| `yarn dev` | Start the development server |
| `yarn build` | Build for production |
| `yarn start` | Start the production server |
| `yarn test` | Run all tests |
| `yarn test:watch` | Run tests in watch mode |
| `yarn test:coverage` | Run tests with coverage report |
| `yarn lint` | Run Biome checks |
| `yarn format` | Format code with Biome |
| `yarn db:infra` | Start local infra (foreground) |
| `yarn db:infra:up` | Start local infra in background |
| `yarn db:infra:down` | Stop local infra |
| `yarn prisma generate` | Regenerate Prisma client after schema changes |
| `yarn prisma migrate dev` | Apply pending migrations (dev) |
| `yarn prisma migrate deploy` | Apply pending migrations (production) |
| `yarn prisma studio` | Open Prisma Studio (database browser) |

---

## Project Structure

```
src/
├── app/                      # Next.js App Router pages
│   ├── (auth)/               # Login + verify pages (centered, no sidebar)
│   ├── (workspace)/          # Authenticated pages (sidebar layout)
│   ├── api/graphql/          # GraphQL endpoint — Apollo Server
│   └── api/auth/session/     # POST/DELETE httpOnly cookie management
├── server/                   # Backend-only code (never imported by client)
│   ├── graphql/              # schema.ts, context.ts, resolvers/, types/
│   ├── services/             # AuthService, UserService, TeamService, WorkflowStateService
│   ├── lib/                  # prisma.ts, redis.ts, jwt.ts, email.ts
│   └── middleware/           # JWT extraction, requireAuth, requireOrgRole, requireTeamMember
├── components/
│   ├── auth/                 # LoginForm, VerifyCodeForm
│   ├── layouts/              # AppShell, Sidebar
│   └── ui/                   # shadcn/ui primitives
└── hooks/                    # useAuth
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

Required environment variables (in addition to defaults): `JWT_SECRET`, `JWT_REFRESH_SECRET`, `APP_URL`, and optionally `POSTGRES_PASSWORD`, SMTP / Google OAuth settings.

---

## Adding shadcn/ui Components

```bash
npx shadcn@latest add <component>
```

---

## Documentation

| Document | Description |
|----------|-------------|
| `docs/PRD.md` | Product requirements |
| `docs/IMPLEMENTATION_PLAN.md` | Phase-by-phase roadmap |
| `docs/ARCHITECTURE.md` | System architecture |
| `docs/DATABASE_SCHEMA.md` | Full PostgreSQL schema |
| `docs/API_DESIGN.md` | GraphQL API contracts |
| `docs/PATTERNS.md` | Code patterns and conventions (read this first) |
| `docs/sprints/` | Per-sprint implementation specs |
