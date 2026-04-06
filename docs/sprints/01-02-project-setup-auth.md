# Sprint 1-2: Project Setup & Auth
## Issue Tracker — Linear Rebuild

**Phase:** 1 (Foundation)  
**Weeks:** 1-2  
**Goal:** Working app shell with authentication

**Prerequisites:** None (first sprint)

---

## 1. Overview

This sprint establishes the foundational infrastructure: database, ORM, GraphQL API server, authentication (email magic link + Google OAuth), and the basic app shell with protected routes. Every subsequent sprint builds on the patterns established here.

---

## 2. Patterns to Establish

> **IMPORTANT:** This is the first sprint. Every pattern set here becomes the standard for all future work. Document decisions in code comments and ADRs where appropriate.

### 2.1 Project Structure Pattern

```
src/
├── app/                          # Next.js App Router pages
│   ├── (auth)/                   # Auth route group (no sidebar)
│   │   ├── login/page.tsx
│   │   └── verify/page.tsx
│   ├── (workspace)/              # Authenticated route group (with sidebar)
│   │   ├── layout.tsx            # Sidebar + main content layout
│   │   └── [workspace]/
│   │       └── page.tsx          # Workspace home
│   ├── layout.tsx                # Root layout (providers)
│   ├── page.tsx                  # Redirect to workspace or login
│   └── globals.css
├── server/                       # Backend code
│   ├── graphql/
│   │   ├── schema.ts             # Schema builder / type defs
│   │   ├── context.ts            # Request context (auth, DB)
│   │   ├── resolvers/
│   │   │   ├── index.ts          # Resolver map
│   │   │   ├── auth.ts           # Auth mutations
│   │   │   ├── user.ts           # User queries/mutations
│   │   │   └── organization.ts   # Org queries
│   │   └── types/
│   │       ├── index.ts          # All type definitions
│   │       ├── scalars.ts        # Custom scalars (DateTime, UUID, etc.)
│   │       └── pagination.ts     # PageInfo, Connection, Edge generics
│   ├── services/
│   │   ├── auth.service.ts       # Auth business logic
│   │   └── user.service.ts       # User business logic
│   ├── lib/
│   │   ├── prisma.ts             # Prisma client singleton
│   │   ├── redis.ts              # Redis client singleton
│   │   ├── jwt.ts                # JWT sign/verify helpers
│   │   └── email.ts              # Email sending (magic links)
│   └── middleware/
│       └── auth.ts               # JWT verification middleware
├── lib/
│   └── utils.ts                  # Shared utilities (existing)
├── components/
│   ├── ui/                       # shadcn/ui components (existing)
│   ├── layouts/
│   │   ├── sidebar.tsx           # App sidebar shell
│   │   └── app-shell.tsx         # Main layout wrapper
│   └── auth/
│       ├── login-form.tsx        # Email login form
│       └── verify-code-form.tsx  # Magic link code entry
└── hooks/
    └── use-auth.ts               # Auth state hook
```

### 2.2 Prisma Pattern

All models follow these conventions established in DATABASE_SCHEMA.md:

- **UUIDs** as primary keys (`@id @default(uuid())`)
- **Soft delete** via `archivedAt DateTime?`
- **Audit trail** via `createdAt`/`updatedAt` on every model
- **Naming:** PascalCase models, camelCase fields, snake_case `@@map` to PostgreSQL tables

```prisma
// prisma/schema.prisma — pattern for all models
generator client {
  provider = "prisma-client-js"
  output   = "../src/generated/prisma"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model Organization {
  id        String   @id @default(uuid()) @db.Uuid
  name      String   @db.VarChar(255)
  urlKey    String   @unique @db.VarChar(63) @map("url_key")
  // ... fields
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz
  archivedAt DateTime? @map("archived_at") @db.Timestamptz

  @@map("organizations")
}
```

### 2.3 GraphQL Resolver Pattern

Resolvers are thin layers that authenticate, then delegate to services:

```typescript
// Pattern: every resolver follows this structure
const resolvers = {
  Query: {
    viewer: async (_parent, _args, ctx) => {
      requireAuth(ctx);  // throws if not authenticated
      return ctx.services.user.findById(ctx.userId);
    },
  },
  Mutation: {
    emailLogin: async (_parent, { input }, ctx) => {
      return ctx.services.auth.sendMagicLink(input.email);
    },
  },
};
```

### 2.4 Service Layer Pattern

Services encapsulate business logic and database access:

```typescript
// Pattern: services receive prisma client, return domain objects
export class AuthService {
  constructor(private prisma: PrismaClient) {}

  async sendMagicLink(email: string): Promise<EmailLoginPayload> {
    // Generate code, store token, send email
  }
}
```

### 2.5 Error Handling Pattern

Use GraphQL errors with `extensions.code` as the primary error discriminator. Clients should always check `extensions.code` rather than HTTP status. Note: HTTP status may still vary (e.g., rate limiting returns HTTP 400 per API_DESIGN.md §12), but `extensions.code` is the canonical error type.

```typescript
import { GraphQLError } from 'graphql';

throw new GraphQLError('Not authenticated', {
  extensions: { code: 'UNAUTHENTICATED' },
});

throw new GraphQLError('Not found', {
  extensions: { code: 'NOT_FOUND' },
});

throw new GraphQLError('Rate limited', {
  extensions: { code: 'RATELIMITED' },  // HTTP 400, see API_DESIGN.md §12
});
```

### 2.6 Environment Configuration Pattern

```
# .env.example — established in this sprint, extended by later sprints
DATABASE_URL=postgresql://user:pass@localhost:5432/issue_tracker
REDIS_URL=redis://localhost:6379
JWT_SECRET=<random-256-bit>
JWT_REFRESH_SECRET=<random-256-bit>
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=http://localhost:3000/auth/google/callback
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
APP_URL=http://localhost:3000
```

---

## 3. Database Schema (Prisma)

**Ref:** `docs/DATABASE_SCHEMA.md` sections 2.1 (Organizations & Users)

### Models for this sprint

```prisma
model Organization {
  id                          String    @id @default(uuid()) @db.Uuid
  name                        String    @db.VarChar(255)
  urlKey                      String    @unique @map("url_key") @db.VarChar(63)
  logoUrl                     String?   @map("logo_url")
  dataRegion                  String    @default("US") @map("data_region") @db.VarChar(2)

  roadmapEnabled              Boolean   @default(false) @map("roadmap_enabled")
  customersEnabled            Boolean   @default(false) @map("customers_enabled")
  initiativesEnabled          Boolean   @default(false) @map("initiatives_enabled")

  securitySettings            Json      @default("{}") @map("security_settings")
  authSettings                Json      @default("{}") @map("auth_settings")
  themeSettings               Json?     @map("theme_settings")

  fiscalYearStartMonth        Int       @default(1) @map("fiscal_year_start_month")

  createdAt                   DateTime  @default(now()) @map("created_at") @db.Timestamptz
  updatedAt                   DateTime  @updatedAt @map("updated_at") @db.Timestamptz
  archivedAt                  DateTime? @map("archived_at") @db.Timestamptz

  members                     OrganizationMember[]
  teams                       Team[]

  @@map("organizations")
}

model User {
  id                String    @id @default(uuid()) @db.Uuid
  name              String    @db.VarChar(255)
  displayName       String    @map("display_name") @db.VarChar(255)
  email             String    @unique @db.VarChar(255)
  initials          String    @db.VarChar(4)
  avatarUrl         String?   @map("avatar_url")
  avatarBgColor     String    @default("#6366f1") @map("avatar_bg_color") @db.VarChar(7)

  active            Boolean   @default(true)
  lastSeen          DateTime? @map("last_seen") @db.Timestamptz
  timezone          String?   @db.VarChar(63)

  statusEmoji       String?   @map("status_emoji") @db.VarChar(32)
  statusLabel       String?   @map("status_label") @db.VarChar(255)
  statusUntilAt     DateTime? @map("status_until_at") @db.Timestamptz

  passwordHash      String?   @map("password_hash")
  googleId          String?   @map("google_id") @db.VarChar(255)

  createdAt         DateTime  @default(now()) @map("created_at") @db.Timestamptz
  updatedAt         DateTime  @updatedAt @map("updated_at") @db.Timestamptz

  orgMemberships    OrganizationMember[]
  authTokens        AuthToken[]

  @@map("users")
}

model OrganizationMember {
  id              String   @id @default(uuid()) @db.Uuid
  organizationId  String   @map("organization_id") @db.Uuid
  userId          String   @map("user_id") @db.Uuid
  role            String   @default("member") @db.VarChar(20) // owner, admin, member, guest

  createdAt       DateTime @default(now()) @map("created_at") @db.Timestamptz
  updatedAt       DateTime @updatedAt @map("updated_at") @db.Timestamptz

  organization    Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  user            User         @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([organizationId, userId])
  @@index([organizationId])
  @@index([userId])
  @@map("organization_members")
}

model AuthToken {
  id              String   @id @default(uuid()) @db.Uuid
  userId          String   @map("user_id") @db.Uuid
  type            String   @db.VarChar(20) // magic_link, refresh, api_key
  tokenHash       String   @map("token_hash")
  code            String?  @db.VarChar(6)  // magic link 6-digit code

  expiresAt       DateTime @map("expires_at") @db.Timestamptz
  lastUsedAt      DateTime? @map("last_used_at") @db.Timestamptz
  revokedAt       DateTime? @map("revoked_at") @db.Timestamptz

  label           String?  @db.VarChar(255) // for API keys
  ipAddress       String?  @map("ip_address") @db.VarChar(45)
  userAgent       String?  @map("user_agent")

  createdAt       DateTime @default(now()) @map("created_at") @db.Timestamptz

  user            User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@index([tokenHash])
  @@map("auth_tokens")
}
```

---

## 4. GraphQL API

**Ref:** `docs/API_DESIGN.md` sections 2 (Authentication), 3 (Core Schema Types), 4.1-4.2 (Organization, User)

### Queries

```graphql
type Query {
  viewer: User!
  organization: Organization!
}
```

### Mutations

```graphql
type Mutation {
  emailLogin(input: EmailLoginInput!): EmailLoginPayload!
  emailVerify(input: EmailVerifyInput!): AuthPayload!
  googleAuthExchange(code: String!, redirectUri: String!): AuthPayload!
  tokenRefresh(refreshToken: String!): AuthPayload!
  logout: LogoutPayload!
}

input EmailLoginInput {
  email: String!
}

input EmailVerifyInput {
  email: String!
  code: String!
}

type EmailLoginPayload {
  success: Boolean!
}

type AuthPayload {
  success: Boolean!
  accessToken: String!
  refreshToken: String!
  expiresIn: Int!       # 86400 (24h)
  user: User!
}

type LogoutPayload {
  success: Boolean!
}
```

### Types to implement

```graphql
scalar DateTime
scalar UUID

type User {
  id: ID!
  name: String!
  displayName: String!
  email: String!
  initials: String!
  avatarUrl: String
  avatarBackgroundColor: String!
  active: Boolean!
  isMe: Boolean!
  timezone: String
  lastSeen: DateTime
  statusEmoji: String
  statusLabel: String
  statusUntilAt: DateTime
  createdAt: DateTime!
  updatedAt: DateTime!
}

type Organization {
  id: ID!
  name: String!
  urlKey: String!
  logoUrl: String
  dataRegion: String!
  roadmapEnabled: Boolean!
  createdAt: DateTime!
  updatedAt: DateTime!
  archivedAt: DateTime
}
```

---

## 5. Auth Flow Implementation

**Ref:** `docs/ARCHITECTURE.md` section 6.1 (Authentication Flow)

### Email Magic Link

1. User enters email on `/login`
2. `emailLogin` mutation → generate random 6-digit code, store hashed in `auth_tokens` with 15-min expiry
3. Send email with code
4. User enters code on `/verify`
5. `emailVerify` mutation → verify code, create/find user, return JWT access token (24h) + refresh token (30d)
6. Store tokens in httpOnly cookies
7. Redirect to workspace

### Google OAuth

1. Client redirects to Google OAuth consent screen
2. Google redirects to `/auth/google/callback` with authorization code
3. `googleAuthExchange` mutation → exchange code for Google tokens → get user profile
4. Create or link user account
5. Return access + refresh tokens

### Token Lifecycle

- **Access token:** JWT, 24h expiry, contains `{ userId, orgId }`
- **Refresh token:** opaque, 30d expiry, stored hashed in `auth_tokens`
- **Refresh flow:** `tokenRefresh` mutation → verify refresh token → issue new pair
- **30-minute grace period** on old refresh token after rotation

---

## 6. Files Created

| File | Purpose |
|------|---------|
| `prisma/schema.prisma` | Database schema (Organization, User, OrganizationMember, AuthToken, Team stub) |
| `prisma.config.ts` | **Prisma 7:** datasource URL for CLI commands |
| `.env.example` | Environment variable template |
| `src/server/lib/prisma.ts` | Prisma client singleton (uses `@prisma/adapter-pg`) |
| `src/server/lib/redis.ts` | Redis client singleton |
| `src/server/lib/jwt.ts` | JWT sign/verify (access + refresh tokens) |
| `src/server/lib/email.ts` | Email transport for magic links (dev: console log) |
| `src/server/graphql/schema.ts` | GraphQL schema definition |
| `src/server/graphql/context.ts` | Request context builder (auth, prisma, services) |
| `src/server/graphql/types/scalars.ts` | Custom scalar types (DateTime, UUID) |
| `src/server/graphql/types/pagination.ts` | Relay pagination types (PageInfo) |
| `src/server/graphql/resolvers/auth.ts` | Auth mutations + `AuthPayload.user` resolver |
| `src/server/graphql/resolvers/user.ts` | `viewer` query, `User` type resolvers |
| `src/server/graphql/resolvers/organization.ts` | `organization` query |
| `src/server/graphql/resolvers/index.ts` | Resolver map |
| `src/server/services/auth.service.ts` | Magic link, OAuth, token lifecycle |
| `src/server/services/user.service.ts` | User lookup/creation/lastSeen |
| `src/server/middleware/auth.ts` | JWT extraction + `requireAuth` guard |
| `src/app/api/graphql/route.ts` | Next.js API route for GraphQL endpoint |
| `src/app/api/auth/session/route.ts` | **Added:** POST/DELETE httpOnly cookie management |
| `src/app/(auth)/login/page.tsx` | Login page |
| `src/app/(auth)/verify/page.tsx` | Magic link verification page |
| `src/app/(auth)/layout.tsx` | Auth layout (centered, no sidebar) |
| `src/app/(workspace)/layout.tsx` | Workspace layout (sidebar + content) |
| `src/app/(workspace)/[workspace]/page.tsx` | Workspace home (empty state) |
| `src/components/layouts/sidebar.tsx` | Sidebar shell (navigation placeholder) |
| `src/components/layouts/app-shell.tsx` | Main content wrapper |
| `src/components/auth/login-form.tsx` | Email input + submit + Google OAuth button |
| `src/components/auth/verify-code-form.tsx` | 6-digit code input (auto-submits on URL prefill) |
| `src/hooks/use-auth.ts` | Auth state management hook |
| `src/middleware.ts` | Next.js middleware for protected routes |

---

## 7. Dependencies Installed

```bash
# Backend
yarn add @apollo/server @as-integrations/next graphql graphql-tag
yarn add @prisma/client @prisma/adapter-pg pg
yarn add jose                    # JWT (edge-compatible, runs in Next.js middleware)
yarn add nodemailer              # Email sending
yarn add ioredis                 # Redis client
yarn add zod                     # Input validation

# Dev
yarn add -D prisma @types/nodemailer @types/pg
```

> **Note:** `graphql-scalars` was evaluated but not used — custom `DateTime` and `UUID` scalars were implemented directly in `src/server/graphql/types/scalars.ts` to avoid the dependency.

---

## 8. Acceptance Criteria

**Status: ✅ Complete (Sprint 1-2 implemented)**

- [x] `prisma migrate dev` creates all 4 tables with correct indexes
- [x] `POST /api/graphql` with `emailLogin` mutation sends a 6-digit code (dev: logged to console via `[Email] Magic link for …`)
- [x] `emailVerify` with correct code returns JWT access + refresh tokens
- [x] `viewer` query with valid Bearer token returns the authenticated user
- [x] `viewer` query without token returns `UNAUTHENTICATED` error
- [x] `organization` query returns the user's organization
- [x] Google OAuth flow creates a new user and returns tokens
- [x] `tokenRefresh` with valid refresh token returns a new token pair
- [x] `logout` revokes the refresh token
- [x] `/login` page renders email form with Google OAuth button
- [x] `/verify` page accepts 6-digit code (auto-submits when code prefilled via URL)
- [x] Unauthenticated users are redirected to `/login` via Next.js middleware
- [x] Authenticated users see the workspace layout with empty sidebar shell
- [x] Tokens are stored in httpOnly cookies via `POST /api/auth/session`

**Implementation notes:**
- GraphQL endpoint is `POST /api/graphql` for all mutations (not separate REST endpoints)
- Cookie setting is a separate step: client receives tokens from GraphQL then calls `POST /api/auth/session` which verifies and sets `httpOnly` cookies
- Magic link codes use `crypto.randomInt` (CSPRNG); only SHA-256 hash stored in DB
- Refresh tokens pre-generate a UUID before signing to avoid two-step DB writes
- `updateLastSeen` is debounced: skips writes if `lastSeen` is within the last 5 minutes
- `src/generated/prisma/` is gitignored — run `yarn prisma generate` after checkout

---

## 9. Cross-References

| Topic | Document | Section |
|-------|----------|---------|
| Database schema (SQL) | `docs/DATABASE_SCHEMA.md` | 2.1 Organizations & Users |
| Auth mutations (GraphQL) | `docs/API_DESIGN.md` | 2. Authentication |
| User/Org types (GraphQL) | `docs/API_DESIGN.md` | 4.1-4.2 |
| Auth flow diagrams | `docs/ARCHITECTURE.md` | 6.1 Authentication Flow |
| Authorization model | `docs/ARCHITECTURE.md` | 6.2 Authorization Model |
| Token security | `docs/ARCHITECTURE.md` | 6.3 Data Security |
| Routing structure | `docs/ARCHITECTURE.md` | 4.3 Routing |
