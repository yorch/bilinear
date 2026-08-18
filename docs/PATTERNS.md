# Code Patterns

## Bilinear — Linear Rebuild

**Established:** Sprint 1-2
**Status:** Living document — updated every time a convention changes. For the
date of the last change run `git log -1 --format=%ad -- docs/PATTERNS.md`; a
hand-maintained stamp here only ever drifts.

> This is the primary onboarding document for new contributors. All patterns here are the mandated conventions for the codebase. If you deviate from a pattern, document why.

> **This file is ~2,900 lines.** Read the section you need from the table of
> contents below — don't read it end to end. Sections are append-only and
> numbered in the order they were established, so a higher number means newer,
> not more important.

---

## Table of Contents

<!-- Numbers are append-only and never reused, so they can be cited from other
     docs. §13 was never assigned; §80 was briefly a second §77. -->

- [1. Project Structure](#1-project-structure)
- [2. Prisma Pattern (Prisma 7)](#2-prisma-pattern-prisma-7)
- [3. GraphQL Resolver Pattern](#3-graphql-resolver-pattern)
- [4. Service Layer Pattern](#4-service-layer-pattern)
- [5. GraphQL Context Pattern](#5-graphql-context-pattern)
- [6. Error Handling Pattern](#6-error-handling-pattern)
- [7. Token Security Pattern](#7-token-security-pattern)
- [8. Authentication Middleware Pattern](#8-authentication-middleware-pattern)
- [9. Session Cookie Pattern](#9-session-cookie-pattern)
- [10. Environment Variable Pattern](#10-environment-variable-pattern)
- [11. Performance Patterns](#11-performance-patterns)
- [12. Frontend Data Pattern (Sprint 7-8+)](#12-frontend-data-pattern-sprint-7-8)
- [14. Authorization Pattern (Sprint 3-4)](#14-authorization-pattern-sprint-3-4)
- [15. Entity CRUD Pattern (Sprint 3-4)](#15-entity-crud-pattern-sprint-3-4)
- [16. Testing Pattern (Sprint 3-4)](#16-testing-pattern-sprint-3-4)
- [17. MobX Store Pattern (Sprint 7-8)](#17-mobx-store-pattern-sprint-7-8)
- [18. Sync Provider Pattern (Sprint 7-8)](#18-sync-provider-pattern-sprint-7-8)
- [19. SyncAction Generation Pattern (Sprint 7-8)](#19-syncaction-generation-pattern-sprint-7-8)
- [20. Search Pattern (Sprint 9-10)](#20-search-pattern-sprint-9-10)
- [21. Command Palette Pattern (Sprint 9-10)](#21-command-palette-pattern-sprint-9-10)
- [22. Keyboard Shortcut Pattern (Sprint 9-10)](#22-keyboard-shortcut-pattern-sprint-9-10)
- [23. Theme System Pattern (Sprint 11-12)](#23-theme-system-pattern-sprint-11-12)
- [24. Toast Notification Pattern (Sprint 11-12)](#24-toast-notification-pattern-sprint-11-12)
- [25. Skeleton / Loading State Pattern (Sprint 11-12)](#25-skeleton--loading-state-pattern-sprint-11-12)
- [26. Error Boundary Pattern (Sprint 11-12)](#26-error-boundary-pattern-sprint-11-12)
- [27. Code Splitting Pattern (Sprint 11-12)](#27-code-splitting-pattern-sprint-11-12)
- [28. Rate Limiting Pattern (Sprint 11-12)](#28-rate-limiting-pattern-sprint-11-12)
- [29. Structured Logging Pattern (Sprint 11-12)](#29-structured-logging-pattern-sprint-11-12)
- [30. Sidebar Collapse Pattern (Sprint 11-12)](#30-sidebar-collapse-pattern-sprint-11-12)
- [31. E2E Testing Pattern (Sprint 11-12)](#31-e2e-testing-pattern-sprint-11-12)
- [32. Adding a New Sync Entity (Sprint 13-14)](#32-adding-a-new-sync-entity-sprint-13-14)
- [33. Board View / Drag-and-Drop Pattern (Sprint 17-18)](#33-board-view--drag-and-drop-pattern-sprint-17-18)
- [34. Filter Builder Pattern (Sprint 19-20)](#34-filter-builder-pattern-sprint-19-20)
- [35. Notification Pattern (Sprint 21-22)](#35-notification-pattern-sprint-21-22)
- [36. Comment Thread Pattern (Sprint 29-30)](#36-comment-thread-pattern-sprint-29-30)
- [37. TipTap Rich Text Editor Pattern (Sprint 27-28)](#37-tiptap-rich-text-editor-pattern-sprint-27-28)
- [38. Triage Workflow Pattern (2026-05-05)](#38-triage-workflow-pattern-2026-05-05)
- [39. Initiative Roll-up Pattern (2026-05-05)](#39-initiative-roll-up-pattern-2026-05-05)
- [40. Webhook Dispatch Pattern (2026-05-05)](#40-webhook-dispatch-pattern-2026-05-05)
- [41. GitHub Integration Pattern (2026-05-17)](#41-github-integration-pattern-2026-05-17)
- [42. Issue Reaction Pattern (2026-05-18)](#42-issue-reaction-pattern-2026-05-18)
- [43. Initiative Updates Pattern (2026-05-18)](#43-initiative-updates-pattern-2026-05-18)
- [44. Lazy Daily Snapshot Pattern — Project Progress History (2026-05-18)](#44-lazy-daily-snapshot-pattern--project-progress-history-2026-05-18)
- [45. Editor Image Paste Pattern (2026-05-18)](#45-editor-image-paste-pattern-2026-05-18)
- [46. Sub-Initiative Hierarchy Pattern (2026-05-21, hardened post-review)](#46-sub-initiative-hierarchy-pattern-2026-05-21-hardened-post-review)
- [47. Sidebar Favorites Pattern (2026-05-21)](#47-sidebar-favorites-pattern-2026-05-21)
- [48. Guest Role Enforcement Pattern (2026-05-21, hardened post-review)](#48-guest-role-enforcement-pattern-2026-05-21-hardened-post-review)
- [49. Issue Snooze Pattern (2026-05-21)](#49-issue-snooze-pattern-2026-05-21)
- [50. Bulk Update Pattern (2026-05-21)](#50-bulk-update-pattern-2026-05-21)
- [51. YJS Collaborative Editing (2026-05-22)](#51-yjs-collaborative-editing-2026-05-22)
- [52. Favorites Sidebar (2026-05-22)](#52-favorites-sidebar-2026-05-22)
- [53. Sub-Initiatives Tree (2026-05-22)](#53-sub-initiatives-tree-2026-05-22)
- [54. Issue Timeline View (2026-05-22)](#54-issue-timeline-view-2026-05-22)
- [55. Issue Mentions in Editor (2026-05-22)](#55-issue-mentions-in-editor-2026-05-22)
- [56. Project Mentions in Editor (2026-05-24)](#56-project-mentions-in-editor-2026-05-24)
- [57. Label Group Enforcement Pattern (2026-05-24)](#57-label-group-enforcement-pattern-2026-05-24)
- [58. Duplicate Relation Auto-Cancel Pattern (2026-05-24)](#58-duplicate-relation-auto-cancel-pattern-2026-05-24)
- [59. iCal Cycle Feed Pattern (2026-05-24)](#59-ical-cycle-feed-pattern-2026-05-24)
- [60. Initiative Health Badge Pattern (2026-05-24)](#60-initiative-health-badge-pattern-2026-05-24)
- [61. Audit Log Pattern (2026-06-06)](#61-audit-log-pattern-2026-06-06)
- [62. SAML SSO Pattern (2026-06-06)](#62-saml-sso-pattern-2026-06-06)
- [63. SCIM 2.0 Provisioning Pattern (2026-06-06)](#63-scim-20-provisioning-pattern-2026-06-06)
- [64. Analytics Extension Pattern (2026-06-06)](#64-analytics-extension-pattern-2026-06-06)
- [65. My Issues Cross-Team View (2026-06-07)](#65-my-issues-cross-team-view-2026-06-07)
- [66. Sub-Issue Progress Rollup UI (2026-06-07)](#66-sub-issue-progress-rollup-ui-2026-06-07)
- [67. Personal API Tokens (2026-06-07)](#67-personal-api-tokens-2026-06-07)
- [68. Keyboard Shortcut Help Modal (2026-06-07)](#68-keyboard-shortcut-help-modal-2026-06-07)
- [69. Bulk Actions Toolbar (2026-06-07)](#69-bulk-actions-toolbar-2026-06-07)
- [70. Cycle Burndown Chart (2026-06-07)](#70-cycle-burndown-chart-2026-06-07)
- [71. Issue Templates CRUD UI (2026-06-07)](#71-issue-templates-crud-ui-2026-06-07)
- [72. Project Milestones UI (2026-06-07)](#72-project-milestones-ui-2026-06-07)
- [73. GraphQL Mutation Centralization (2026-06-08)](#73-graphql-mutation-centralization-2026-06-08)
- [74. Platform Admin Console (2026-07-03)](#74-platform-admin-console-2026-07-03)
- [75. Internationalization (i18n) — English/Spanish (2026-07-03)](#75-internationalization-i18n--englishspanish-2026-07-03)
- [76. Client/Server Contract Safety (2026-08-01)](#76-clientserver-contract-safety-2026-08-01)
- [77. Multiple Organizations Per User (2026-08-01)](#77-multiple-organizations-per-user-2026-08-01)
- [78. Organization Membership Management — Invitations & Removal (2026-08-01)](#78-organization-membership-management--invitations--removal-2026-08-01)
- [79. Design System — tokens, accent, primitives (2026-08-01)](#79-design-system--tokens-accent-primitives-2026-08-01)
- [80. Schema and Sync Residuals (2026-08-02)](#80-schema-and-sync-residuals-2026-08-02)
- [81. Installable Web App (PWA) (2026-08-02)](#81-installable-web-app-pwa-2026-08-02)

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

The `prisma` instance is exposed on context so authorization guards can perform queries without going through a service (e.g. `requireTeamMember` checks `teamMembership` directly). `requireOrgRole` no longer needs it — the caller's org role rides `AuthContext`; see below.

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

Role-based guards throw `GraphQLError` with a `FORBIDDEN` code. The team guards
query; the org guard does not:

```typescript
// src/server/middleware/auth.ts — role-based guards
export function requireOrgRole(ctx: AuthContext, roles: string[]): string  // sync
export async function requireTeamMember(prisma, teamId, orgId, userId): Promise<void>
export async function requireTeamOwner(prisma, teamId, orgId, userId): Promise<void>
```

`requireOrgRole` reads `ctx.orgRole`, which `extractAuthContext` resolved from
the membership row it must load anyway for the session-validity check. It used
to take `(prisma, orgId, userId, roles)` and re-query that row at each of its
~25 call sites — a second traversal of the same unique index, per mutation, for
a value the request already had. Two invariants keep that safe:

- **`orgId` and `orgRole` are cleared together.** Anything that drops `orgId`
  must drop the role in the same assignment, or an authorization check could
  pass against a workspace the session no longer holds. `requireOrgRole` also
  fails closed on a role without an org, as defence in depth.
- **Every call site runs before its resolver's first write**, so nothing
  observes a role it changed itself. Per-request freshness is exactly what the
  extra read gave.

It returns the caller's *actual* role rather than a bare pass/fail, because an
owner and an admin both clear `['owner', 'admin']` and only one of them may
touch ownership.

Usage in resolvers:

```typescript
teamCreate: async (_parent, { input }, ctx) => {
  requireAuth(ctx);                              // sync — throws UNAUTHENTICATED
  requireOrgRole(ctx, ['owner', 'admin']);       // sync — throws FORBIDDEN
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

Add the table to the Dexie schema. **Pre-launch this means editing the
existing `.version(1)` block in place** — nothing is deployed, so a version
generation buys nothing and costs a dev browser one re-bootstrap. After the
first real deployment it becomes a new `.version(N)` block instead, never an
edit to a previous one (see the `TODO(pre-launch)` above the `AppDatabase`
constructor):

```typescript
this.version(1).stores({
  // …existing tables…
  projectUpdates: 'id, projectId, userId',
});
```

Then add it to `CACHED_COLLECTIONS` in `src/lib/db-collections.ts`. This is
not optional for a **synced** collection, and it is not cosmetic: a client with
a warm cache would otherwise keep that table empty forever, because the delta
path only carries rows that *changed*. The stamp makes such a client
re-bootstrap once instead. A test asserts the constant matches the tables
`fullBootstrap` actually clears, so forgetting this fails the suite rather than
shipping a silent hole.

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
- **Threads are exactly one level deep** — `CommentService.create` rejects a reply to a reply, and both the query fragment and `CommentCard`'s recursion mirror that cap. See §76.4 for why (a grandchild has no hydrated `author`, and `Comment.author: User!` nulls the entire response).
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
3. Includes `CollaborationCaret.configure({ provider })` (from
   `@tiptap/extension-collaboration-caret` — the Tiptap v3 successor to the
   deprecated `@tiptap/extension-collaboration-cursor`) for presence indicators.
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
- **Rendering** — shown only when `subIssues.length > 0`: a `{completedCount}/{subIssues.length}` counter and a `<ProgressBar className="h-1 w-20" fillClassName="bg-success" />` proportional to `completionPct`. (It predates both the shared primitive and the token migration — it was hand-rolled markup with a `bg-green-500` fill, a literal `yarn lint:tokens` now rejects.)

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
- **Core lib** — `src/lib/i18n/index.ts` exports `locales`, `defaultLocale`, `dictionaries`, `LOCALE_COOKIE`, the `Locale`/`Dictionary` types, and the shared `translate(locale, key, params?)` function. `translate()` is the single lookup+interpolation core: dotted-key resolve → English fallback → raw key, then `{placeholder}` substitution. **Both** the client `useTranslations()` hook and the server `getServerTranslations()` helper delegate to it, so key resolution, fallback, and interpolation are identical client- and server-side — do not hand-roll a second dotted-key walker (tests use `translate('en'|'es', …)` too). Interpolation passes the replacement as a *function* to `String.prototype.replaceAll`, so `$`-sequences in user-supplied values (issue titles, entity names) are inserted literally rather than treated as `$&`/`` $` ``/`$$` special patterns.
- **Provider** — `src/providers/locale-provider.tsx` (`LocaleProvider`, `useLocale`). Client context seeded from a server-read cookie (`RootLayout` reads `cookies()` and passes `initialLocale`, mirroring `attribute="class"` theme init) — no hydration-mismatch flash. `setLocale` persists to the `locale` cookie (1yr, `LOCALE_COOKIE_MAX_AGE` — shared with the session route so the two writers can't drift) and updates `document.documentElement.lang`. The cookie has a **second writer**: `/api/auth/session` seeds it from `User.locale` at login (see §75.3), so a language chosen on one device follows the account to the next. **Rendering-strategy tradeoff:** reading `cookies()` in the root layout opts every route into dynamic rendering (the cost of cookie-based locale without URL-segment routing). Acceptable here — the app is auth-gated and real-time, so it is dynamic anyway; the only public page (`/roadmap/[slug]`) is slug+password specific and per-request by nature.
- **Hook** — `src/hooks/use-translations.ts` (`useTranslations()`) returns a `t(key, params?)` function (a `useCallback` memoized on `locale`) that delegates to `translate()`. Usage: `t('nav.myIssues')`, or with params `t('auth.failedToStart', { provider: 'Google' })`.
- **UI toggle** — `src/components/language-toggle.tsx` (`LanguageToggle`), a two-way EN/ES cycle button styled identically to `ThemeToggle`; supports the same `compact` prop. Rendered in the sidebar footer (`src/components/layouts/sidebar.tsx`) next to `ThemeToggle`, both expanded and collapsed states.
- **Server components + translations** — a server component (e.g. a `page.tsx` with `export const metadata`) cannot call `useTranslations` directly (it's a client hook). Two ways out, and the second is usually better. If the page already calls `getServerTranslations()` (any page with `generateMetadata()` does), resolve the strings there and pass them into a **presentational, non-client** component — that is what the `(auth)` pages do with `AuthHeader`: three near-identical `'use client'` header siblings collapsed into one prop-driven component, removing three client bundles for markup that was static anyway. Reach for a `'use client'` sibling only when the heading needs client state or an interactive child; a component that merely renders translated text does not.
- **Coverage** — app-wide: sidebar/layout/command palette/notifications, the full auth flow, issues (list, board, detail panel, comments, relations, sub-issues, attachments, templates), projects (list, detail, milestones, updates, roadmap), cycles/analytics/roadmap/initiatives, teams/custom fields/documents/editor, and every settings page (workspace, team, security, webhooks, integrations, import/export, audit log, automations, triage). ~1,450 translation keys across 30 top-level namespaces (`accent`, `admin`, `analytics`, `auth`, `commandPalette`, `common`, `customFields`, `customViews`, `cycles`, `documents`, `editor`, `email`, `errors`, `initiatives`, `invite`, `issueDetail`, `issues`, `language`, `layout`, `meta`, `nav`, `notifications`, `projects`, `properties`, `roadmap`, `settings`, `sync`, `teams`, `theme`, `workspaceSwitcher`).
- **Extending coverage** — add a namespaced key to *both* `en.json` and `es.json` (same shape), then call `t('namespace.key')` from a `useTranslations()`-backed client component. Never hardcode a second English copy elsewhere; grep the dictionaries first — many short strings (`common.cancel`, `common.save`, priority/status labels) are already shared across features.
- **Multi-agent authorship caveat** — this sweep was done by parallel agents each covering a disjoint file set, then reconciled by hand. Two structural bugs surfaced from that parallelism and are worth knowing about if similar sweeps happen again: (1) a `t` reference used inside a nested component that doesn't itself call `useTranslations()` (each component needs its own hook call — closures don't share it), and (2) a helper computed value (like `PRIORITY_OPTIONS`) defined once at the top of a file but referenced inside a sibling component that never received it — pass or recompute it locally. Both are caught by `yarn typecheck`, not `yarn lint`.
- **Fixed-enum labels are a recurring gap** — config objects like `PROJECT_STATUS_CONFIG`/`PROJECT_HEALTH_CONFIG` (`src/lib/project-constants.ts`) bake an English `label` field in for color-pairing convenience. Rendering `.label` directly leaks untranslated English. The fix is a parallel `*_LABEL_KEYS: Record<string, string>` map (`PRIORITY_LABEL_KEYS` in `src/components/properties/priority-icon.tsx`, `PROJECT_STATUS_LABEL_KEYS`/`PROJECT_HEALTH_LABEL_KEYS` in `project-constants.ts`) — keep the `.color`/`.icon` fields on the original config object, but never read `.label` from it in a component. For priority specifically, resolve via the exported helper `priorityLabelKey(p)` (in `priority-icon.tsx`) → `t(priorityLabelKey(p))`; it centralizes the out-of-range fallback so call sites don't each hand-write `?? PRIORITY_LABEL_KEYS[0]` (which was duplicated ~15× and had already drifted — two sites omitted the fallback). Import `PROJECT_HEALTH_LABEL_KEYS` from `project-constants.ts`; don't re-declare a local copy.
- **`PRIORITY_CONFIG` no longer has a `label`, deliberately** — it carried one until the 2026-08-04 audit, and the issue context menu rendered it straight to screen, so the priority submenu stayed English in every locale while every other priority UI translated correctly. The field is gone (along with the zero-consumer `PRIORITY_LABELS`, and `PRIORITY_OPTIONS` is now value-only), `src/lib/issue-utils.test.ts` asserts no `label` property exists on either, and `priorityLabelKey()` + `t()` is the only path to a priority's display name. **Prefer this shape for new enum configs**: presentation fields on the config, names in the dictionary, so there is nothing untranslated to reach for. The remaining `.label`-bearing configs above are the older pattern.
- **Enum-keyed label maps must be keyed on the vocabulary that actually reaches them** — `activity-timeline.tsx`'s `FIELD_LABEL_KEYS` was keyed by *UI* field names while the server writes *column* names (`stateId`, not `status`; `labelAdded`/`labelRemoved`, not `labels`) to `IssueActivity.field`. `getFieldLabel` returns the raw field when a key is missing, so the feed read "changed **stateId** from … to …" in every locale, English included — and it never even reached `t()`, so no dictionary check could catch it. When a map is keyed by a value crossing a layer boundary, enumerate the *writers* (here `TRACKED_ACTIVITY_FIELDS` plus the one-off pushes in `issue.ts`/`issue-relation.ts`/`comment.ts`) rather than assuming the two vocabularies agree.
- **Shared `lib/` helpers are an i18n blind spot** — plain TS utilities (not React components) are invisible to a component-by-component audit but are often called from many components at once. `formatRelativeTime` and `formatDueDate` in `src/lib/issue-utils.ts`/`src/lib/utils.ts` returned hardcoded English ("5m ago", "yesterday", `date-fns` `format(..., 'MMM d')` with no locale) — used by 7+ components (comments, activity timeline, notifications, project/initiative updates). Fixed by taking a `t`/`date-fns` `Locale` parameter instead of hardcoding; callers pass `useTranslations()`'s `t` and `DATE_FNS_LOCALES[locale]` (see `src/lib/date-fns-locale.ts`). When auditing for missed strings, grep `src/lib/*.ts` for `toLocaleDateString('en`, `date-fns` `format(` calls, and string literals returned directly from exported functions — not just JSX.
- **`INTL_LOCALES`** (`src/lib/i18n/index.ts`) and **`DATE_FNS_LOCALES`** (`src/lib/date-fns-locale.ts`) map the app `Locale` to `Intl`/`date-fns` locale tags respectively — use these instead of hardcoding `'en-US'` in any `toLocaleDateString`/`toLocaleString`/`date-fns format()` call.
- **Metadata titles/descriptions** — `export const metadata` is evaluated at build/request time outside React context and can't call `useTranslations()`. Use `export async function generateMetadata()` and call `getServerTranslations()` (`src/lib/i18n/server.ts`, which reads the `locale` cookie server-side) instead — see `src/app/layout.tsx` and the `(auth)` page files for the pattern.
- **App/brand name is centralized, not translated** — the product name is `APP_NAME` in `src/lib/app-config.ts` (defaults to `'Bilinear'`, overridable via `NEXT_PUBLIC_APP_NAME`). It is a proper noun, so it is NOT translated — import `APP_NAME` and interpolate it. Client components (sidebar), server components (`AuthHeader`), server `generateMetadata()`, and server code (`src/server/lib/email.ts`) all import the same constant; never hardcode the brand string. i18n strings that embed the name use an `{appName}` placeholder filled from `APP_NAME` (e.g. `t('auth.signInTitle', { appName: APP_NAME })`), keeping the translated sentence structure separate from the configurable name. Wire-protocol tokens that happen to contain the name — the `X-Bilinear-*` webhook headers, the `User-Agent`, the `/bilinear` Slack command, iCal `PRODID`/`UID` — are stable identifiers external systems depend on and must stay literal.

### 75.1 Follow-ups (2026-07-04)

- **`useFormatters()` hook** — `src/hooks/use-formatters.ts` bundles the locale-bound formatters so components stop threading `t` + `DATE_FNS_LOCALES[locale]` through every `formatRelativeTime`/`formatDueDate` call by hand. Returns `{ formatRelativeTime, formatDueDate, formatDate(value, options?), formatDateTime(value, options?), intlLocale, dateFnsLocale }`, all pre-bound to the active locale (memoized on `[t, locale]`). `formatDate`/`formatDateTime` wrap `toLocaleDateString`/`toLocaleString` with `INTL_LOCALES[locale]` so a raw `new Date(x).toLocaleDateString('en-US')` never leaks. Prefer this hook over calling the `src/lib/*.ts` primitives directly from components; the primitives still take explicit `t`/`Locale` params for non-React callers.
- **Transactional emails are localized** — `src/server/lib/email.ts` no longer hardcodes English. Every `send*Email` takes a `locale?: string | null`, resolved through the private `emailT(locale, key, params)` helper (`translate(isLocale(locale) ? locale : defaultLocale, key, params)`) so an unknown/absent value falls back to `defaultLocale`. Strings live under the `email.*` namespace (`magicLink`, `assignment`, `mention`, `comment`, `statusChange`, plus `footer`/`viewIssue`/`viewComment`). HTML body keys receive already-escaped actor/issue-link markup as `{actor}`/`{issueLink}` params; the plain-text variants get the raw values. The recipient's language comes from the new **`User.locale`** column (see DATABASE_SCHEMA §2.1) — `NotificationService` selects `locale` alongside `email`/`emailNotificationsEnabled` and passes it through; `AuthService.sendMagicLink` passes the looked-up user's `user?.locale` (brand-new accounts have none yet → default). The column is written by the `userUpdateLocale(locale)` mutation, which `LocaleProvider.setLocale` fires (fire-and-forget) whenever the user switches language, keeping the cookie (UI) and the DB (emails) in sync. Server-side validation lives in `UserService.updateLocale` (throws `InvalidLocaleError` → `BAD_USER_INPUT`).
- **Platform admin console (`/admin`) is covered** — the `(admin)` route tree uses the `admin.*` namespace (`nav`, `dashboard`, `tenants`, `users`, `audit`, `impersonation`). The `layout.tsx` server component is guards/redirects only, but its title **is** translated — it exports `generateMetadata()` + `getServerTranslations()` (→ `admin.nav.metaTitle`) rather than a static `metadata` object, which is the app-wide pattern for any server-rendered title. Dynamic status badges resolve keys like `admin.tenants.status.${status}` — keep every enum value represented in the dictionary. Watch for `t` shadowing: several admin list pages had `.map(t => …)` params renamed to `tenant`/`result` so they don't clobber the translation function.

### 75.2 Pluralization & first-visit locale (2026-07-04)

- **CLDR pluralization** — `translate()` handles grammatical plurals so "1 issue" / "2 issues" render correctly per locale (Spanish and English both distinguish `one`/`other`; the mechanism supports the full CLDR set — `zero`/`one`/`two`/`few`/`many`/`other` — for any language added later). Convention: a pluralizable key `foo.bar` is stored as **CLDR-category sibling keys** `foo.bar_one` and `foo.bar_other` (add `_few`/`_many`/etc. only when a locale needs them), each still using `{count}` for the number. When a caller passes `{ count }` (a number), `translate()` selects the category via a memoized `Intl.PluralRules`. Fallback order is **target-locale-first**: it tries the target locale's selected category, then the target locale's `_other`, and only then the default locale's forms — so a locale missing the selected category renders its own `_other` rather than leaking an English string mid-sentence. Keys **without** `_*` siblings are unaffected — the plural lookup returns `null` and falls through to the plain direct lookup — so `{count}`-bearing strings that don't need plural forms (parenthetical counts like `Issues ({count})`, abbreviated relative times like `{count}m ago`) stay as single keys. Do **not** hand-branch `count === 1 ? t('…Singular') : t('…Plural')` in components anymore — that older ad-hoc pattern (and the `issue(s)`/`row(s)` hacks) was migrated to `_one`/`_other`; just call `t('foo.bar', { count })`.
- **`{count}` is locale-number-formatted** — the `count` placeholder specifically is rendered through a memoized locale `Intl.NumberFormat`, so large counts get the locale's digit grouping (`1.500.000` in `es`, `1,500,000` in `en`; note Spanish's CLDR `minimumGroupingDigits=2` means 4-digit numbers like `1500` are *not* grouped). Every **other** placeholder is inserted verbatim via `String()` — years, ids, and pre-escaped HTML fragments must not be reformatted — so only name a numeric placeholder `count` when it is a cardinal you want grouped.
- **First-visit locale from `Accept-Language`** — `getServerLocale()` (`src/lib/i18n/server.ts`) still lets an explicit choice win (the `locale` cookie), but a visitor with no cookie yet now falls back to their browser's `Accept-Language` before the app default. Parsing lives in the pure, unit-tested `pickLocaleFromAcceptLanguage(header)` (`src/lib/i18n/index.ts`): it honors `q`-weights (not header order), matches on the base subtag (`es-MX` → `es`), skips `*`, unsupported languages, and `q=0` entries (RFC 7231 — `q=0` means the client explicitly rejects that language), and returns `null` when nothing matches. This reads `headers()` in the root layout, which — like the existing `cookies()` read — keeps every route dynamically rendered; no regression since the app is already dynamic (see §75).
- **Persisting the choice is fire-and-forget but not silent** — `LocaleProvider.setLocale` still writes `User.locale` via `userUpdateLocale` without awaiting, but it no longer swallows every error: `UNAUTHENTICATED` (expected on the pre-login `login`/`verify` pages) is ignored, while any other GraphQL/network failure is `console.warn`ed so a silently stale locale (→ wrong-language emails) is diagnosable.
- **Tests** — `src/lib/i18n/index.test.ts` covers plural category selection + fallback, `{count}` number grouping (and non-count passthrough), and the `Accept-Language` ranking/`q=0`/matching edge cases. Extend it when adding a locale with a richer plural rule set.

### 75.3 The dictionary guard, and what it deliberately cannot see (2026-08-04)

- **`translate()` fails silently in both directions, which is why a guard exists.** A lookup miss returns the *key*, and the `key` parameter is a bare `string` — so a key nobody defined renders its own dotted path into the UI with no throw, no type error and no lint failure. Two shipped that way: a CSV export wrote the literal text `issues.cycleNumber` into every export's Cycle column, and the create-project modal labelled its status field `projects.status.label`.
- **`src/lib/i18n/dictionary.test.ts` is the CI guard.** Four assertions: every literal `t('…')` key found by scanning non-test source exists in `en.json`; `en`/`es` carry identical key sets; each key's `{placeholder}` set matches across locales; every pluralized base has an `_other` sibling (the category `resolvePluralRaw` falls back to). Adding a key to one locale and forgetting the other, or dropping a placeholder from a translation, now fails the build rather than degrading quietly at runtime.
- **It only matches single-quoted literals, on purpose.** Biome enforces single quotes, so a double-quoted or template-literal argument is by definition a *computed* key the scan cannot resolve — guessing at those would produce false failures. Which means: **a green scan says nothing about the ~30 computed call sites** (`t(labelKey)`, `` t(`admin.tenants.status.${status}`) ``). Those must be verified by tracing each constant to the full set of values it can produce and checking each resulting key by hand — that is how the `activity-timeline` bug above was found, and the scan could never have caught it.
- **When auditing, check the writers, not just the readers.** The highest-severity findings in the 2026-08-04 sweep were all *reachability* bugs, not missing translations: a key map keyed on the wrong vocabulary, and raw enum values (`atRisk`, `inProgress`, `multi_select`) rendered where a translated sibling already existed elsewhere in the same codebase. Grepping for hardcoded English prose would have missed every one of them.
- **`User.locale` is read for the UI, not just for email.** It was write-only until this sweep: `setLocale` persisted it so transactional emails matched the chosen language, but `getServerLocale()` consults only the cookie → `Accept-Language` → default, so a language chosen on one machine did not travel to the next. `/api/auth/session` now seeds the `locale` cookie from the column at login, on the **same `findUnique` the accent preference already makes** — no extra query, and the hot path still reads only the cookie. It is rewritten on *every* session install (not just when a stored value exists) so one account's language can't linger for the next user of a shared browser, and *cleared* rather than defaulted to `en`, which is what lets `Accept-Language` still apply for a user who never chose one. Mirrors §79.3's accent seeding exactly.
- **Invite emails use the *inviter's* locale, and there is no org-level default.** `locale` is a `User` column only — no `Organization.locale` exists — so an invitee with no account yet gets the inviter's language as the best available guess. The doc comment on `sendOrganizationInviteEmail` claimed the opposite ("the organization's inviter-independent default") for a while; if a real org default is ever wanted, it needs a new column, not a comment.

---

## 76. Client/Server Contract Safety (2026-08-01)

There is no Apollo Client and no GraphQL codegen: every client document is a plain template literal and every response type is hand-written. Nothing structurally prevents a document from drifting away from the schema, so these conventions carry that weight instead.

### 76.1 `gqlQuery` / `gqlMutate` — never read `res.data` unguarded

`/api/graphql` answers **HTTP 200** for every GraphQL-level failure — validation errors, `UNAUTHENTICATED` on an expired session, `FORBIDDEN`, resolver faults. `gql()` therefore does **not** throw; it resolves with `errors` populated and `data` undefined. A call site that only reads `res.data` cannot tell "the request failed" from "there is genuinely nothing here", and one that `await`s and then toasts reports success for a rejected write.

- **Reads** → `gqlQuery<T>(query, variables, key)` (`src/lib/graphql.ts`). Throws on `res.errors`, unwraps `data[key]`. This is what makes an error state (`InlineRetry`, an error banner) reachable at all — `useRetryableFetch` only sets `error` when the fetcher **throws**, so a fetcher that swallows errors and returns `[]` renders a failed load as a legitimate empty state and leaves the retry branch as dead code.
- **Writes whose outcome is reported to the user** → `gqlMutate(query, variables)`. The success toast, the local state mutation, the form close, and the list removal must all be unreachable when the server rejected the request. **Never clear the user's input before the write is confirmed** — a destroyed comment body or custom-field draft is worse than a failed request.
- **Plain `gql()`** is still correct where you need the raw envelope: to read `extensions.code` (see 76.2), or for a genuinely fire-and-forget write with no UI consequence. Both cases deserve a comment saying which.
- A failed read must **never** fall through to an authoritative empty state. "No API tokens yet" / "You're all caught up" / "No completed issues in this range" are read as facts.

### 76.2 Nullable root fields return genuine partial responses

Most root fields are non-null, so an error propagates to the root and `data` comes back null — which is why "check `data` presence" mostly happens to work. The exceptions are `samlConfiguration`, `githubIntegration`, `slackIntegration` and `publicRoadmap`: all nullable, so an error returns `data` populated with that field `null` **alongside** `errors`. Writing `field ?? null` makes a `FORBIDDEN` indistinguishable from "not configured" — on these four security/integration surfaces that means an admin sees a blank form and may overwrite live config, or reconnects an already-connected integration and mints a second webhook secret.

Read `extensions.code` and branch: a permission error is "you can't see this" (muted text, section hidden), anything else is a real failure (destructive styling), and only a clean error-free response with a null field means "not configured". `settings/security/page.tsx` carries the reference implementation for both SAML and SCIM.

### 76.3 SyncAction payload contract

The client's apply is a **whole-object replace**, and the same payload is persisted to Dexie. Two rules follow:

- **Broadcast the full row, never a stub.** `{ completedAt, id }` truncates the cached entity to two fields — it drops out of `findByTeamId`, scrambles date sorts, and is persisted in that state (only a re-bootstrap repairs it, and the cached-data path takes `deltaSync()` instead). Re-fetch the entity after a mutation that only returns a partial result.
- **Say nothing about a relation rather than saying "empty".** A payload with no label information is not an issue with no labels. `normalizeIssueRow(data, previousLabelIds)` (exported from `src/stores/issue-store.ts`) collapses the three label shapes the server can send — `labelAssignments`, `labels`, `labelIds` — and falls back to the previously-cached ids. **Both** the MobX pool and the Dexie write must use it; normalizing in only one made label loss survive reloads.
- **Strip anything not meant for every client.** SyncActions fan out org-wide over WebSocket. `Organization` payloads omit `authSettings`/`securitySettings`; `getBootstrapData` omits those plus the credential columns on `User` (`passwordHash`, `googleId`, `githubId`, `calendarFeedToken`, `isPlatformAdmin`). The `DB*` interfaces in `src/lib/db.ts` declare none of them, so a leak is invisible to TypeScript while still landing in IndexedDB in plaintext.
- **Per-recipient models need a client-side filter.** `Notification` rows belong to one user but broadcast to the whole org, so `SyncManager` drops actions whose `userId` isn't the current user (`NotificationStore` documents its pool as already user-scoped, and `markAllRead()` depends on that). Note there is deliberately no `'I'` SyncAction for notifications — live delivery would broadcast private notifications org-wide and needs a per-user channel first.
- **A partial payload riding another model's stream must be discriminated.** `issueCustomFieldValuesSet` emits `{ customFieldValues }` on the `Issue` stream with no `id` and no issue columns. `SyncManager` checks for keys beyond `customFieldValues` before treating it as an issue row, and guards the `db.issues` put on `id` being present — a Dexie put that violates the inbound keyPath throws **inside the shared transaction**, rolling back every other entity in the batch including the `lastSyncId` cursor.

### 76.4 Comment threads are exactly one level deep

`CommentService.create` rejects a reply whose parent already has a parent. `COMMENT_INCLUDE` hydrates two levels of relations, so a grandchild would come back with no `author` — and `Comment.author` is `User!`, which nulls the reply, then its parent, then the whole non-null `comments` list, then `data`. The client mirrors the cap: `COMMENTS_FRAGMENT` selects a bare `replies { id }` at the third level, and `CommentCard` only recurses at `depth === 0` so it never mounts a card for a stub. `Comment.author` additionally falls back to `ctx.loaders.user` for rows created before the cap existed. **This is an API contract** — a client that walks the reply tree deeper gets a validation-clean document that returns `data: null`.

### 76.5 Non-null SDL fields over nullable sources

A `!` field resolving to null nulls its whole parent and propagates up until it reaches a nullable field — one bad row takes down an entire response. Before marking a field non-null, check the backing column *and* the lookup: an org-scoped or `archivedAt`-filtered relation lookup returns null for a row that still exists. Where the column can't be tightened because the table is shared (`auth_tokens.label` is null for magic-link and refresh tokens), coalesce in a resolver — see `ApiToken.label` / `ScimToken.label` in `resolvers/index.ts`.

### 76.6 The drift guard

`src/lib/graphql-documents.test.ts` scans the source tree for embedded documents, inlines the shared field-list constants they interpolate, and validates each against the real `typeDefs`. It catches unknown fields, wrong argument types, and union selections whose sibling fragments disagree on nullability. It does **not** catch anything about runtime values — variables objects, response-type lies, or nullability the SDL declares correctly but the hand-written TS type gets wrong. Those need the conventions above.
## 77. Multiple Organizations Per User (2026-08-01)

The `organization_members` join table has always allowed a user to hold
memberships in many organizations, but nothing above the schema did. The
session's tenant lives in the access token's `orgId` claim, and that claim
was stamped from `UserService.getOrganizationForUser` — a `findFirst`
ordered by `createdAt: 'asc'`. Every account was therefore pinned to its
oldest membership for the life of the account, with no way to reach a
second workspace short of creating another one (which moved you there and
stranded you, since the next login re-derived the oldest membership again).

**Switching.** `organizationSwitch(organizationId)` re-reads the caller's
membership server-side — that lookup *is* the authorization; without it any
authenticated user could mint a session for an arbitrary org id — then
returns a fresh token pair in the same payload shape as
`organizationCreate`. The client installs the tokens via
`POST /api/auth/session` and then does a **full document load**
(`window.location.assign`, never `router.push`). The hard navigation is
load-bearing, not stylistic: a client-side transition keeps the running
`SyncManager`, MobX stores, and IndexedDB cache of the previous org alive,
and only a fresh document remounts `SyncProvider` → `SyncManager.start()` →
`invalidateCacheIfOrgChanged`, which wipes Dexie before hydrating. All of
this lives in `useOrganizationSwitch` (`src/hooks/use-organization-switch.ts`);
use the hook rather than re-assembling the sequence.

**Listing.** `viewerOrganizations` returns every org the viewer can enter
(`UserService.listOrganizationsForUser`), each with their role and a
`current` flag. It requires only `requireUserId`, deliberately: a user whose
active workspace was suspended — or whose membership in it was revoked —
carries a session with a null `orgId`, and listing/switching is their only
way out. `WorkspaceSwitcher` renders a plain label rather than a dropdown
when the list has fewer than two entries, so single-org accounts keep the
header they had.

**"Usable" orgs.** `ORG_USABLE_WHERE` in `user.service.ts`
(`{ archivedAt: null, suspendedAt: null }`) is the Prisma-`where` twin of
`checkSessionValidity`'s org arm, which evaluates the same rule against an
already-fetched row. Keep them in agreement — an org one admits and the
other rejects is a workspace you can switch into and are immediately thrown
out of. Every membership lookup that feeds a session (`getOrganizationForUser`,
`listOrganizationsForUser`, `findUsableMembership`, and the impersonation
target resolver) filters on it.

**The `orgId` claim is now verified, not just signed.** `checkSessionValidity`
takes a third argument, the caller's `organization_members` row, and fails
closed when it is missing. `extractAuthContext` fetches it alongside the
user/org rows (one extra read on the composite unique index, in the same
`Promise.all`), and both long-lived-connection sweeps — the WS re-auth sweep
and the Yjs `revalidateAccess`/`revalidateRoomAccess` pair — pass it too. A
failed membership check drops `orgId` only, never `userId`: losing one
workspace must not sign you out of the others. Before this, removing someone
from an org left them full access to it until their 24h token expired, which
was survivable when losing your only membership was an edge case and is not
once revocation is routine.

**API keys are org-bound.** `AuthToken.organizationId` is stamped from the
creating session (`createApiToken(userId, orgId, label, opts)`), and
API-key auth reads it instead of inferring the user's oldest membership —
which, for a multi-org account, silently pointed a key created in one
workspace at another. A key with no org (created before the column) resolves
to no org rather than guessing. `listApiTokens`/`revokeApiToken` are
org-scoped for the same reason, so one workspace's settings page never shows
another's credentials.

**The `[workspace]` URL segment is authorization-bearing.** It used to be
decorative — every route below it read `ctx.orgId` and ignored the segment,
so `/other-org/team/ENG` rendered *your* ENG team under someone else's url
key. `src/app/(workspace)/[workspace]/layout.tsx` now compares the segment
to the session: match renders, a mismatch the viewer is a member of renders
`WorkspaceMismatch` (an explicit switch prompt — re-issuing a session
because someone followed a GET link is how a link logs a user out of what
they were doing), and anything else redirects to `/`. The prompt is a client
component specifically so it can read `window.location.pathname` and land
the user on the page they were linked to; server layouts don't receive the
request path. `destinationFor` rebases that path onto the target workspace
and refuses anything that isn't a plain in-app absolute path, since the
value reaches `location.assign`.

**Gaining and losing a membership** is §78 — invitations and removal. This
section is only about holding several and moving between them.

**One payload for "the session was re-issued into an organization."**
Creating a workspace, switching to one, and accepting an invitation to one
all return `EnterOrganizationPayload` and all end with the same
`enterOrganization(ctx, organization)` tail. The client had already unified
them (`enterWorkspace` accepts all three structurally); three identical
GraphQL types were three places for the shape to drift.

## 78. Organization Membership Management — Invitations & Removal (2026-08-01)

§77 made it possible to *hold* several memberships and move between them.
This is how memberships are created and destroyed from inside the app. Before
it, neither existed: the only way to gain a membership was SCIM provisioning,
SAML JIT, the platform admin console, or creating the org yourself, and the
only way to lose one was SCIM deprovisioning — which meant the per-request
membership check §77 added was guarding a transition the product could not
actually perform.

**Invitations** (`OrganizationInviteService`, `organization_invites`). The
raw token is generated once, hashed with SHA-256, and stored as the hash
only — the same treatment magic-link codes and SCIM tokens get. The
invitation email is therefore the sole place the token exists in the clear,
which is why `create()` **sends the mail itself** and revokes the row if the
send fails (raising `InviteEmailFailedError` → `EMAIL_SEND_FAILED`): a
silently undelivered invitation would sit in the pending list looking healthy
while being permanently unusable. Minting and sending belong to one
transaction, not to a resolver that has to remember to sequence them —
`AuthService.sendMagicLink` is the same shape.

Three properties are deliberate and worth not undoing:

- **Acceptance requires an email match.** Without it the link is a bearer
  token and anyone who receives a forwarded copy joins the workspace. The
  comparison is case-insensitive, and the address is lowercased at write
  time so both sides agree.
- **The claim is atomic** — `updateMany` scoped to `acceptedAt: null`, so two
  concurrent acceptances race in the database and exactly one wins. Same
  guard as `AuthService.verifyMagicLink`. A find-then-update would let both
  through.
- **The membership upsert leaves an existing row alone** (`update: {}`).
  Someone who joined by another route while the invitation was outstanding
  must not be silently re-roled by accepting it.

There is no unique constraint on `(organizationId, email)`: re-inviting after
a revoked or expired invitation is ordinary, and a partial unique index
(pending rows only) is inexpressible in Prisma. `create` revokes any
outstanding invitation for the pair inside the same transaction instead, so
issuing a new link always kills the old one.

**Removal** (`OrganizationService.removeMember`) is the *single writer* for
membership removal: the GraphQL mutation and SCIM deprovisioning
(`deactivateUser` / `DELETE /Users/:id`) both route through it. They used to
be two implementations of one concept and had already drifted — only the
in-app one had the last-owner guard, so an IdP could strand a workspace by
deactivating its sole owner. SCIM passes `actor: null`, which means "system
caller": the interpersonal checks (no self-removal, owner-manages-owner)
don't apply, but the structural last-owner guard does. It drops the org
membership and every team membership inside that org, atomically.
`user.active` is deliberately untouched: it is a *global* flag, and removing
someone from one workspace must not sign them out of the others. The removed user loses access on their next request
(`extractAuthContext` re-checks membership) and their WebSocket closes on the
next re-auth sweep, both from §77.

**Owner guards, applied to both.** `requireOrgRole` now returns the caller's
actual role rather than just passing or failing, because an owner and an
admin both clear `['owner', 'admin']` and only one of them may touch
ownership. On top of that allow-list:

- only an owner may grant or revoke the `owner` role, or remove an owner —
  previously an admin could promote a second account of their own to owner
  straight from the members list, a full privilege escalation;
- the last owner can be neither demoted nor removed;
- nobody removes themselves — leaving is a different operation (see below).

The UI mirrors each guard so it never offers an action the server will
reject, but the server is the enforcement point — `MembersSection` derives
`canManage` from the viewer's role in the members query, not from whether an
admin-only request happened to succeed.

**The roster is in the sync pipeline (2026-08-02).** `organizationMemberRemove`
and `organizationMemberUpdateRole` emit `'D'`/`'U' OrganizationMember` actions.
Those were inert for a while — `sync-manager.ts` had no case for the model, so
the settings page reconciled its own copy locally and a second admin's open tab
kept listing someone who had been removed until they reloaded. Closed by
carrying the roster the whole way: `getBootstrapData` ships
`organizationMembers`, Dexie has the table, `OrganizationMemberStore` holds it,
and `applyActions` routes the live actions into it.

It is deliberately a **separate collection from `users`**, because the two
answer different questions. `users` is "who can I see" and is populated for
anyone with a membership; the roster is "who is in this workspace, and as
what". Nothing ever deletes a `User` row, so after a removal the person is
still in `userStore` — membership presence is the only thing that can tell a
current member from a departed one. `MembersSection` now derives its roster,
`canManage` and last-owner check from the store, which deleted its own query,
its optimistic apply, and that apply's rollback branch.

Access never depended on any of this: a removed user loses the org on their
next request and their socket closes on the next re-auth sweep.

**Every writer of `organization_members` owes a SyncAction, and there are
six.** Making the roster synced moved the correctness burden onto the write
side. Two of the six are the GraphQL mutations above; the other four —
invitation acceptance, SCIM provisioning, SCIM re-activation, SAML JIT
provisioning — have no resolver to carry the emit and originally shipped
without one. That is not stale-until-reload: `MembersSection` no longer
refetches, and a warm Dexie cache takes the **delta** path, which carries only
rows that changed. An IdP deprovisioning someone left them in every admin's
members list indefinitely, with a role dropdown and a remove button the server
answers with `NOT_FOUND`.

All six go through `src/server/lib/membership-sync.ts`:

- `joinOrganization(prisma, sync, orgId, userId, role)` — the whole of "they
  joined", write and broadcast together. What SCIM provisioning, SCIM
  re-activation and SAML JIT call. Invitation acceptance is the one path that
  stays split, because its write happens in a service and only the resolver
  holds a `SyncService`.
- `ensureMembership` — the write half. Deliberately **not** an upsert: an
  upsert cannot report which branch it took, and only a real join may be
  broadcast. The unique constraint still settles a concurrent race, and the
  loser re-reads rather than claiming a creation it did not make.
- `announceJoin(prisma, sync, orgId, membership)` — the join broadcast, and
  the reason a bare membership `'I'` is not enough. The bootstrap scopes
  `users` to `orgMemberships: { some: { organizationId } }`, so a client
  already running has no `UserStore` row for someone who joined afterwards —
  and the members list is the intersection of the two pools, so they simply
  never appear. `announceJoin` ships the `User` row first, under
  `USER_SYNC_OMIT` (one constant, shared with the bootstrap query, because two
  hand-maintained redaction lists means a new sensitive column leaks from
  whichever one the author forgot).
- `broadcastMembership` — role changes and removals. Its `action` is typed
  `Exclude<SyncActionType, 'I'>` on purpose: this module exists because
  "remember to also do X" is what four of six writers forgot, so leaving a bare
  `'I'` reachable would rebuild that failure one level up with no type error to
  catch it.

`createWithOwner` is the deliberate exception — the founding owner is the only
member, and their client reaches the workspace through a full document load
that bootstraps the roster anyway.

**Bootstrap uses `replaceAll`, not `upsertMany`.** A bootstrap is an
authoritative load, and `fullBootstrap` is not only the cold-start path — it is
also the delta-failure fallback, which runs *after* `loadFromIndexedDB` has
already filled the pool from a warm cache. Merging there lets a row the server
omitted survive, and for membership omission is the entire signal: nobody
archives a membership, they stop existing.

**The bootstrap write runs on the apply lock.** `SyncManager.runExclusive`
(the single-slot chain `applyActions` uses) also wraps `fullBootstrap`'s Dexie
transaction and store population, because that authoritative load clears Dexie
and clears the roster pool. The fallback reaches it with the WebSocket already
live, so without the lock an action landing between the clear and the
repopulate is erased rather than merely overwritten. That fallback also
schedules the follow-up delta the cold-start path already had — `fullBootstrap`
regresses `lastSyncId` to the snapshot's cursor, so an action that applied
while the snapshot was in flight is re-delivered.

**Adding a synced collection needs more than a Dexie schema edit** — and the
mechanism that carries this is now built. A Dexie upgrade creates the new
object store *empty* and leaves every other table in place, so
`loadFromIndexedDB` would report a usable cache and `start` would take the
delta path — which carries only rows that *changed*. An untouched collection
never backfills, and the surface reading it renders an empty state forever.

So `fullBootstrap` stamps `CACHED_COLLECTIONS` (`src/lib/db-collections.ts`)
into `syncMetadata` **in the same transaction as the rows it describes**, and
`loadFromIndexedDB` refuses any cache whose stamp doesn't cover every required
collection. Adding a collection to bootstrap therefore costs exactly one edit —
add it to that constant — and every existing client re-bootstraps once instead
of running with a hole. A test asserts the constant matches the tables the
bootstrap transaction actually clears, so the two cannot drift.

`favorites` is deliberately excluded: the server's bootstrap payload doesn't
carry it, `fullBootstrap` never writes it, and the sidebar reads favorites from
GraphQL using the store only as a refetch trigger. Listing it would make every
client re-bootstrap forever, since bootstrap could never satisfy the claim.
`pendingTransactions` is excluded because it is the offline queue — the one
thing in the cache that exists nowhere else.

This is independent of the version scheme. While nothing is deployed
`src/lib/db.ts` still edits `.version(1)` in place (see the `TODO(pre-launch)`
above the constructor); the stamp is what makes the eventual `.version(N)` +
`.upgrade()` work safe, not a prerequisite for it.

**Leaving is its own operation (2026-08-02).** `organizationLeave` exists
separately from `organizationMemberRemove`, which still refuses self-removal,
because the two differ in who bears the consequence: removal is done *to*
someone by an admin, leaving is done *by* you and costs you your own access.
Folding them together would have meant either dropping the self-guard — so a
mis-click on your own row in the members list ejects you — or giving "leave" an
admin-only permission check it should not have.

They share the write. Both route through one private `deleteMembership`, so
leaving cascades team memberships in the same transaction and inherits the
last-owner guard: an owner may leave only once another owner exists, otherwise
the workspace is stranded with nobody able to manage it and — unlike a removal
— there is no second party in the room to notice.

**Leaving clears the org from the request context.** `organizationLeave` calls
`clearOrgSession(ctx)`, which nulls `orgId` *and* `orgRole` together. GraphQL
executes root mutation fields **serially against a single context**, which is
what the "nothing observes a role it changed itself" reasoning on `orgRole`
misses: a document selecting `organizationLeave` and then
`organizationInviteCreate` runs the second field after the first deleted the
membership, and its `requireOrgRole` reads the role resolved before the
operation began — mailing an admin invitation into a workspace the caller
provably no longer belongs to. Nulling the role alone is not enough either;
every `requireAuth`-only mutation reads `ctx.orgId` and would keep writing into
the workspace just left. `organizationMemberUpdateRole` owes the same when the
target is the caller (an admin demoting themselves is permitted). Any future
mutation that invalidates the caller's own membership owes it too.

It returns a **`LeaveOrganizationPayload`, not `EnterOrganizationPayload`**.
That type's `organization` is non-null because you always land somewhere;
leaving your last workspace legitimately lands you nowhere, and a null
organization means an org-less session, which still authenticates for
`viewerOrganizations` and workspace creation. The destination is resolved
*after* the delete and through the same usable-org filter login uses, so it can
neither pick the org just left nor land on a suspended one. Client-side it ends
in the same handoff as a switch — install cookies, then a **full document
load** — for the reason spelled out on `useOrganizationSwitch`: only a fresh
document remounts `SyncProvider` and wipes the departed org's Dexie cache.

**Client data access follows §76.1.** Every read here goes through
`gqlQuery` and every user-visible write through `gqlMutate`, so a rejected
request can't render as an empty roster or toast success. Pending invitations are fetched in their own document, gated on the
viewer being an owner/admin — folding them into the roster query saves a round
trip but only works by tolerating a partial response (`data` populated beside
a FORBIDDEN), which is the shape §76.2 exists to warn about.

**Post-login redirects.** Accepting an invitation usually means signing in
first, so `safeRelativePath` (`src/lib/safe-path.ts`) is the single guard for
any externally-supplied path about to be navigated to — a `?next=` param, the
sessionStorage destination stashed across an OAuth round trip
(`rememberPostAuthNext`/`consumePostAuthNext`), or a deep link carried
through a workspace switch (`destinationFor`). It rejects protocol-relative
URLs (`//evil.example.com` starts with a slash but navigates off-origin),
absolute URLs, backslashes, and control characters. Route any new
redirect-target-from-outside through it rather than checking `startsWith('/')`
at the call site.


---

## 79. Design System — tokens, accent, primitives (2026-08-01)

The UI/UX revamp (L1–L4) turned the styling layer into a system with one rule
governing it: **in an issue tracker most of the spectrum is already spoken for
by data.** Red/orange/yellow are priority, green is completed, slate is
backlog. So the brand gradient lives entirely in the *chrome* — selection
rails, focus glow, elevation, one primary action — and never touches the data
layer. That constraint is also why all three accents sit in the cool
violet–azure arc: it is the only band that cannot be misread as status.

### 79.1 Two colour families, and why they behave differently

| Family | Follows the accent? | Roles |
| --- | --- | --- |
| **Brand** | yes | `--brand`, `--brand-2`, `--brand-hover`, `--brand-subtle`, `--brand-subtle-foreground`, `--brand-border`, and `--primary`/`--ring` which alias it |
| **Status** | **no** | `--danger`, `--success`, `--warning`, `--info`, plus `--merged` (GitHub's merged purple) — each with `-subtle` and `-subtle-foreground` |

Status encodes data: "this failed" must mean the same thing whichever accent
the user picked, so those bases are literals. Priority swatches (`--priority-*`)
and collaboration cursors (`--cursor-*`) are fixed for the same reason.
`src/lib/accent.test.ts` enforces both halves — that every status base is free
of `--accent-h`/`--brand`, and that every `-subtle`/`-subtle-foreground` derives
from its own base.

### 79.2 Every accent declares two values; the rest derives

`globals.css` defines only `--brand` and `--brand-2` per accent per theme. Hover,
subtle fill, subtle foreground and border all come from `color-mix`, and the
whole neutral ramp is computed in oklch from `--accent-h` — the accent's own
hue — so the chassis and the accent read as one material rather than dead grey
plus a saturated colour. **Adding a fourth accent is one entry in
`ACCENT_DEFINITIONS` plus a four-line CSS block.**

Specificity matters here and is guarded by a test rather than a comment: a light
`:root[data-accent='ion']` is (0,2,0) and would beat a bare `.dark` at (0,1,0),
painting dark mode with light-mode brand colours. Every dark block is therefore
written `:root.dark[data-accent='…']` (0,3,0).

### 79.3 The accent is a cookie preference, not `next-themes`

`data-accent` is stamped on `<html>` by the root layout from the `accent`
cookie during SSR, so there is no flash and **no `mounted` guard is needed** —
server and client agree on first render (unlike `ThemeToggle`/`LanguageToggle`,
which do need one). `User.accent` persists the choice to the account; it is read
in exactly one place, the session route, which seeds the cookie at login. Never
read it in the layout — that would put a query on every request for a cosmetic
preference.

### 79.4 No raw colours, guarded across the whole palette

`yarn lint:tokens` bans every shade-numbered Tailwind hue and every hex literal
across `src/components`, `src/app`, `src/lib` and `src/hooks`, at a literal-zero
baseline. A fixed palette that genuinely cannot be a token lives in
`globals.css` and is referenced from `.ts` as a `var()` string, never inlined.

The guard originally covered only `zinc`/`indigo`, and **that gap is how 330 raw
red/amber/green/blue status colours accumulated across 49 files while the
baseline read as a clean zero**. Worth remembering when adding any ratchet: a
green ratchet only proves the absence of what the ratchet measures.

### 79.5 Primitives — extend, never hand-roll

`PageHeader`/`Toolbar` are the *only* page chrome; every route uses them, which
is what ended the four different header paddings that used to shift as you
navigated. `EmptyState` replaces centred strings. Skeletons come in four shapes
(`IssueListSkeleton`, `PageSkeleton`, `RowsSkeleton`, `DetailPanelSkeleton`) —
there are no bare "Loading…" strings left. Elevation is a three-step scale
(`shadow-e1` rows, `shadow-e2` popovers, `shadow-e3` modals); no raw Tailwind
shadows remain.

Four smaller primitives followed, each extracted from markup that had been
copy-pasted rather than shared: `ProgressBar` (the `bg-muted` track and
`bg-brand` fill, inlined in six places — sizing comes from `className`, and
`fillClassName` covers the one `bg-success` case), `ColorDot` (`StatusDot` at
10px and `LabelDot` at 8px were the same swatch twice; its colour stays an
inline `backgroundColor` because it is entity data from the DB, not a token),
`SegmentedControl` (two byte-identical analytics toggles), and `SectionHeader` +
`SectionAddButton` in `shared/` (the uppercase subsection header and its
"+ Add X" control — `as` keeps each call site's heading level, so consolidating
the markup doesn't flatten the document outline).

A later pass added two more, both extracted from markup rather than invented:
`PromptDialog` in `shared/` (the single-text-field counterpart to
`ConfirmDialog` — same `ModalDialog` shell, same Cancel/confirm footer, one
labelled `Input`), and `POPOVER_ITEM_CLASS` exported from
`ui/select-popover.tsx`. The second is a *constant*, not a component,
deliberately: the option row inside a popover panel was one class string
repeated at 14 sites across 6 files, and `SelectPopover`'s roving-focus query
walks the real buttons those sites render — wrapping them in a component would
have changed the DOM the primitive reaches into for no gain.

**`window.prompt` is banned for the same reason `window.confirm` is.** It is
unstyled, untranslatable, blocks the main thread, and browsers may suppress it
outright. Use `PromptDialog`. The case that made this a rule rather than a
preference: the platform-admin impersonation picker printed a numbered list of
organizations and asked the operator to *type an index*, so one mistyped digit
impersonated into the wrong tenant with no confirmation step.

**`/design`** renders the whole token layer and every primitive; switching
accent or theme re-renders every specimen. Open it when changing anything in
`ui/` or `globals.css` — this repo has no visual-regression suite, so it is the
manual stand-in.

**Mobile touch targets come from `TOUCH_TARGET` / `TOUCH_TARGET_SQUARE`**
(`@/lib/utils`), never a hand-typed `max-md:h-11 …` string. The class was
retyped at 51 sites across 33 files before the extraction, which made WCAG
2.5.8 opt-in by copy-paste — a new icon button that forgot it shipped with a
sub-44px hit area and nothing caught it. The two forms are not
interchangeable: `TOUCH_TARGET` sets a width *floor* (`min-w-11`) so a trigger
whose label is wider than its icon — the reaction bar's "🙂 React", the editor
toolbar's `B`/`I`/`U` — still fits, while `TOUCH_TARGET_SQUARE` pins an exact
44×44 for a fixed-size icon. They are exported strings rather than a `Button`
size because none of those 51 sites render `<Button>` (they are raw
`<button>`/`<Link>`), and `SelectPopover` builds its own trigger and accepts
only a `triggerClassName` — a component-shaped API could not reach it at all.

### 79.6 The contrast contract (`src/lib/contrast.test.ts`)

Computed tokens are what makes the system coherent and also what makes contrast
easy to break by accident: nudging one base lightness silently moves a dozen
derived pairs across three accents and two themes, and **lint, typecheck and
build do not look at colour at all**. `src/lib/contrast.test.ts` is the only
gate that does. It parses `globals.css`, resolves each token through the real
cascade (`:root` → accent block → `:root.dark[data-accent]`), converts oklch to
sRGB, composites translucent fills over their backdrop, and asserts 25 pairs
across all six accent/theme combinations. A final test proves the harness is
non-vacuous by feeding it a deliberately regressed token.

Thresholds are WCAG 1.4.3 (4.5:1 for body text, 3:1 for large) and 1.4.11 (3:1
for the boundary of a control). Two tokens are deliberately **not** asserted,
and the reasoning is load-bearing:

- **`--border`** separates surfaces (row dividers, section rules). It is not a
  control boundary and carries no state, so 1.4.11 does not apply. `--input`
  *is* the control boundary and is asserted.
- **`--foreground-faint`** is reserved for decorative marks — the em-dash
  standing in for "no value", background swatches. Every informational use was
  moved to `--muted-foreground`. If you reach for it for real text, move the
  text instead of relaxing the test.

Four traps this caught, all invisible to every other gate, and all the same
underlying mistake — **a colour tuned to be seen is not a colour that can be
stood on**:

1. **A gradient has two ends.** The primary button's label cleared 4.5:1 against
   `--brand` and measured **1.76:1** against the far stop. `--gradient-brand-cta`
   exists for exactly this — a darkened variant of the display gradient, used
   only where text sits on top.
2. **A text role is not a fill role.** `--destructive` (solid button fill) is
   deliberately *not* an alias of the `danger` text role. `danger` is tuned to
   read on a near-black ground in dark mode, so it is light; white on it
   measured **2.77:1**.
3. **`--primary` is not `--brand`.** A brand light enough to read as a selection
   rail on a white page cannot carry white text — `--primary-foreground`
   measured **4.45:1** on a raw brand under Aurora and **3.65:1** under Ion.
   `--primary` is therefore the *darkened* brand (the CTA gradient's first
   stop); `--ring` and `--brand` stay undarkened, because they are lines and
   rails and never a ground for text.
4. **A `-subtle-foreground` inverts by theme.** It is dark ink in light mode and
   light ink in dark, because it sits on a near-page-coloured tint. Put it on a
   *solid* status fill and it breaks in exactly one theme: the impersonation
   banner rendered light-on-light amber. `--warning-foreground` is the dark ink
   for that fill, and it does not flip.

Two consequences for how you write a status chip:

- **Never hardcode `text-white` over a caller-supplied fill.** This is why
  `Badge` has no `solid` variant. White does not clear 4.5:1 on *any* status
  base — ~2.6:1 on `--warning` in light, ~1.4:1 in dark — because an amber light
  enough to read as "warning" cannot carry white text. Use a `tone`, whose
  fill/ink pair is asserted.
- **The vivid `bg-{status}` fills are for shapes that carry no text**: the
  health dot in the project list, a progress bar, a connection pip. The moment a
  label goes on one, it needs the subtle pair (or a dedicated ink like
  `--warning-foreground`).

One CSS-cascade rule the baseline focus indicator depends on: **`:focus-visible`
must live inside `@layer base`**. Tailwind's utilities are in `@layer utilities`
and unlayered CSS beats every layer, so as a bare rule it out-ranked
`focus-visible:outline-none` and stamped a hard outline on every primitive that
styles its own focus ring.

Colour is never the only channel: priority is a glyph plus a `title`, status is
a shape plus a label (WCAG 1.4.1). Loading surfaces announce through
`LoadingRegion` (`role="status"` + `aria-busy` + sr-only text) — the shimmer
itself is `aria-hidden`, since replacing the old literal "Loading…" strings with
silent divs is exactly the kind of regression a visual redesign introduces.

## 80. Schema and Sync Residuals (2026-08-02)

### 80.1 Entity references are `ID`, uniformly

Every **argument and input field** that names an entity — `id`, `teamId`, `issueId`, `projectId`, `cycleId`, `initiativeId`, `userId`, `parentId`, `assigneeId`, `stateId`, `leadId`, `ownerId`, `definitionId`, `relatedIssueId`, `projectMilestoneId`, `moveToTeamId`, and the `[ID!]` list forms — is typed `ID`/`ID!`, never `String`/`String!`.

This is not cosmetic. GraphQL's variable-usage rule compares the *declared* variable type against the argument type, so `$teamId: String!` against a `teamId: ID!` argument is a hard `GRAPHQL_VALIDATION_FAILED` — the entire request is rejected. When the same logical argument was spelled four different ways across 24 positions, writing a document from memory was a coin flip. Three deliberate exceptions:

- `lastSyncId: String!` — an opaque BIGSERIAL cursor, not an entity reference, and already consistent across all 31 occurrences.
- `slugId: String!` — a human-readable slug.
- `idpEntityId: String!` — a SAML entity URI.

Two separate checks in `src/lib/graphql-documents.test.ts` keep this true, and
the distinction matters:

- **document → schema.** Every embedded document is validated against the real
  `typeDefs`. This catches a document whose declared variable type no longer
  matches the argument.
- **schema → convention.** A second assertion walks every input-object field and
  field argument in the built schema and fails any entity-reference name typed
  `String`, with the three exceptions above as an explicit allow-list.

The first cannot substitute for the second: a new field declared
`teamId: String!` paired with a document that *also* says `String!` validates
perfectly. Only the schema assertion catches the convention drifting, which is
the actual root cause this section exists to prevent. It deliberately ignores
output fields — variables are never compared against those, so they carry no
drift hazard.

### 80.2 SyncAction payloads are stripped centrally

`SyncService.recordSyncAction` is the single choke point every SyncAction passes through, and it strips `Issue.descriptionState` / `Document.contentState` (`SYNC_PAYLOAD_OMITTED_FIELDS`). Strip **there**, not at the row producers: there are ~20 emitters fed by at least 7 different producers, including raw `prisma.issue.findUnique` calls in `automation.service.ts` and `ws/index.ts`, so a per-producer fix is neither exhaustive nor future-proof.

Worth knowing: a Prisma `Bytes` column inside a `Json` argument does **not** throw — `serializeJsonQuery` base64-encodes it (`{"descriptionState":"AQIDBA=="}`) because the `ArrayBuffer.isView` branch precedes `toJSON`. So this was silently writing ~1.33× the blob into `sync_actions.data`, publishing it to every client in the org, and having each persist it under a key `DBIssue`/`DBDocument` never declared.

### 80.3 `sync_actions` retention needs a staleness signal, not just a sweep

The table is append-only — one row per mutation — so it has an hourly retention sweep (`SYNC_ACTION_RETENTION_DAYS`, `pruneSyncActions`). **A sweep alone is a data-loss bug:** a client whose cursor predates the deleted span would get a successful-looking delta that silently omits everything pruned.

So the sweep records `Organization.syncActionsPrunedThroughXactId`, and `getDeltaSyncActions` returns `staleCursor: true` for any cursor at or below it; the client discards its cache and re-bootstraps.

**Prune and mark are deliberately in different clocks.** The sweep deletes by `created_at` — retention is a wall-clock policy, and that column is indexed — but the mark records the highest `xact_id` deleted, because `(xactId, id)` is the space the delta cursor lives in (§ the commit-order fence). A timestamp mark cannot be compared against an xid8 cursor at all. The column is `Decimal(20, 0)`, not `BigInt`: xid8 is unsigned 64-bit and overflows a signed `int8` at the top of its range.

**Prune and mark are also one statement.** A data-modifying CTE does `DELETE … RETURNING` → `MAX(xact_id)` per org → `UPDATE organizations`, so there is no ordering hazard to reason about — it is structurally impossible for the delete to land without its mark. `GREATEST(COALESCE(existing, 0), …)` keeps the mark monotonic, so a sweep that deletes only low-xid rows can never walk the mark backwards. Only orgs that actually lost rows are marked; marking every org combines with a zero bootstrap cursor into a permanent delta → `staleCursor` → bootstrap loop.

Test against the **recorded high-water mark**, never a computed `now - retention` horizon. A horizon cannot distinguish "these rows were pruned" from "this org has no history that old", so it forces a needless full bootstrap on every young org — and on every client still holding a legacy id-only cursor, which `parseCursor` deliberately maps to the zero cursor *so that it can be caught up by delta*. Null (nothing pruned yet) is the common case and is never stale.

### 80.4 Soft-delete filters want partial indexes

Every list/board/bootstrap read filters `archived_at IS NULL AND trashed = false`. A plain `@@index([team_id])` also covers the archived set, which grows without bound while the live set does not — so the live-set predicate gets a partial index, `issues_team_id_state_id_active_idx`, in the custom migration file. Prisma's `@@index` takes no `WHERE`, which is why it lives there rather than in the schema.

Add one only for a predicate you have actually measured. This branch originally carried two more (`idx_issues_live_team`, `idx_issues_live_org`), derived from reading the query shapes rather than from a profile; they were dropped when the measured index above landed and covered the same reads. Every index is a write-path cost paid on every insert and update, so a speculative one is a regression with no upside.

### 80.5 Delete semantics are a decision, not a default

When adding a missing FK, pick `onDelete` from what the null state *means*:

- `File.uploaderId → User` is **SetNull** — deleting a user must not delete the attachments they uploaded.
- `Webhook.teamId → Team` is **Cascade** — `null` means "org-wide", so SetNull would silently broaden a team-scoped webhook to the entire organization.
- `SlackIntegration.defaultTeamId → Team` is **SetNull** — losing the default team must not uninstall the integration.


### 80.6 Fetch-on-mount goes through `useRetryableFetch`

Any component that loads data in an effect uses `useRetryableFetch(fetcher, deps, initialValue)` (`src/hooks/use-retryable-fetch.ts`). It returns `{ data, setData, loading, error, errorMessage, refetch }`, and `refetch` **is** the retry handler you hand to `InlineRetry`.

`error` is the boolean nearly every call site switches on. `errorMessage` carries the thrown error's own text and exists for the surfaces where the specific failure is the diagnostic rather than noise — the platform-admin console, where "couldn't load" tells an operator nothing that the server's message wouldn't tell them better. Render `errorMessage ?? t('common.somethingWentWrong')` so a non-`Error` throw still says something. Both are cleared when a retry starts, so a caller may render `loading` and `error` as siblings without the spinner and the failure row appearing together.

Two outcomes deliberately do **not** travel through `error`: a row that does not exist, and a request the viewer is not allowed to make. Both are answers, not failures, and neither is retryable — offering a Retry that can never succeed is worse than offering none. Model them as data instead: `admin/tenants/[id]` lets `fetchTenant` resolve to `null`, and `settings/audit-log` returns an `AuditOutcome` union whose `forbidden` variant renders its own message (`isPermissionError` from `src/lib/graphql.ts` is what distinguishes it).

Do not hand-roll the equivalent. The recognisable shape — `useState` for data, a `loadError` boolean, a `useState(0)` `reloadKey`, a `let cancelled = false` flag with `if (!cancelled)` guards, and a `biome-ignore useExhaustiveDependencies` for the reload key — was written out fifteen times before being consolidated, and the hand-rolled version is strictly worse: it races on out-of-order responses where the hook discards stale ones via a monotonic request id.

**The one shape the hook does not fit** is fetch-then-seed-a-form: a page that spreads one response across many `useState` form fields rather than rendering it (`settings/page.tsx`, `settings/roadmap`, `settings/security`, `settings/integrations`, `team/[key]/settings`, `issue/[id]`). Routing those through the hook means calling `setX(...)` from inside the fetcher, which is a side effect in the one place that must stay pure. They keep their own effect deliberately — that is not drift, and "consolidate the last six" is the wrong instinct until a second hook exists for that shape.

The hook only sets `error` when the fetcher **throws**, which is why the fetcher must use `gqlQuery`/`gqlMutate` (§76.1) rather than swallowing errors and returning `[]`. A fetcher that returns an empty array on failure renders as a legitimate empty state and leaves the retry branch dead — that combination is what hid a real query bug for a long time.

### 80.7 Derived values are computed fields, never columns

Progress, scope and any other value that is a pure function of a related row
set is exposed as a **GraphQL field backed by a DataLoader**, not stored on the
parent. `Project.progress`/`scope` and `Cycle.progress`/`scope` both work this
way, through `projectProgress` / `cycleProgress` over
`{Project,Cycle}Service.getProgressBatch`.

Both models used to carry real columns for these, and **neither was ever
written** — see DATABASE_SCHEMA.md §2.9-pre for the archaeology. The two failed
differently, and the pair is the argument for this rule:

- `projects` had field resolvers, so the columns were merely dead weight — but
  two server-side readers (`roadmap/[slug]/page.tsx`, the initiatives page)
  bypassed GraphQL and read the raw column, rendering 0% for every project.
- `cycles` had **no** field resolvers, so the SDL's `progress: Float!` fell
  through to the default resolver, which read the dead column. Every query
  answered 0, silently, for as long as the field had existed.

Three rules follow:

1. **Don't add the column.** If you want a cached rollup, it needs a named
   single writer, an enumerated set of invalidating transitions, and something
   that keeps it honest. `Initiative.progress` is the one in this codebase that
   clears that bar; treat any new one as a proposal to be argued, not a default.
2. **Every field the SDL declares needs a resolver or a real column.** A
   non-null scalar with neither is not a compile error and not a validation
   failure — it is a field that quietly returns a zero value forever.
3. **Never re-derive it on the client from a MobX pool.** `issueStore` holds
   only the issues that client happens to have, and a guest is scoped to issues
   they created or are assigned to, so one owned issue in a 50-issue project
   renders as 100%. Fetch the server-resolved field. Both the project views and
   `cycle-detail-view` had this bug and both now fetch it.

Batch it when you add it. `getProgressBatch` answers any number of parents in
two `groupBy` queries; the per-parent version it replaced issued two `count`s
each, so a 20-row list cost 40 round-trips.

## 81. Installable Web App (PWA) (2026-08-02)

The app installs from Chrome's omnibox (and every other Chromium browser, plus
Safari's "Add to Dock"). Three pieces, and each is only as interesting as the
constraint that shaped it.

### 81.1 The manifest is a route, not a static file

`src/app/manifest.ts` is a Next metadata route served at
`/manifest.webmanifest`; Next injects the `<link rel="manifest">` itself. Being
a route is what lets it read `APP_NAME` (per-deployment brandable) and the same
`meta.description` translation `generateMetadata` uses.

Two fields are load-bearing beyond the obvious:

- **`id: '/'`.** Without it the browser derives the app's identity from
  `start_url`, so changing `start_url` later would register as a *different*
  app rather than an update to the installed one.
- **`start_url: '/'`,** never a workspace path. Which workspace a session can
  enter is decided server-side and can change between launches (an org gets
  suspended, a membership is revoked), so the root route's redirect is the only
  entry point that is still correct months after install.

The manifest is fetched **without credentials** unless the link carries
`crossorigin="use-credentials"`, so the `locale` cookie usually isn't sent and
`getServerLocale` falls through to `Accept-Language`. That is the right answer
for a value the OS caches at install time anyway — don't "fix" it by making the
manifest depend on the session.

### 81.2 The service worker deliberately caches nothing but the offline page

`public/sw.js` exists for two reasons: Chrome's installability criteria want a
worker with a `fetch` handler, and a navigation that can't reach the network
should show something better than the browser's error screen.

It does **not** precache the app shell, and that is not an omission. Every HTML
response here is rendered per user and per workspace — it carries the viewer's
org, teams and role — so a cached copy is a staleness problem and, on a shared
machine, a disclosure one. The app's offline story already lives a layer up:
the workspace is mirrored into IndexedDB and writes queue in `TransactionQueue`
(§12, §18). Caching the shell safely needs a *user-independent* shell route to
cache, which does not exist today; that is the work to do if this is ever
revisited, not "add the HTML to the precache list".

It doesn't cache `/_next/static` either — those URLs are content-hashed and
already served `immutable` for a year, so an SW cache in front of the HTTP
cache buys nothing and adds a second, unbounded copy that only a version bump
evicts.

Two properties worth keeping when editing it:

- **Only navigations are intercepted.** `/api/graphql`, `/api/sync/*`, uploads
  and the realtime endpoints must reach the network untouched — a worker that
  intercepts them is a sync bug that survives the deploy that fixed it. This
  matters more since `WS_PUBLIC_URL`/`YJS_PUBLIC_URL` grew their same-origin
  `/ws` and `/collab` forms (see the README's deployment section): both now sit
  inside the worker's scope. A WebSocket handshake is never dispatched to
  `fetch` handlers, so the worker could not intercept the upgrade itself even
  if the guard were wrong — but the guard is what keeps everything around it
  (the `/api/auth/ws-ticket` fetch, any same-origin polling fallback) on the
  network, and `src/lib/pwa.test.ts` asserts both paths pass through.
- **A server error is not "offline".** `fetch` rejects only when the network is
  unreachable; a 4xx/5xx resolves normally and is passed straight through, so a
  real error page is never replaced by the offline one.

Because the file lives in `public/`, Biome doesn't lint it, TypeScript doesn't
see it and the build just copies it. `src/lib/pwa.test.ts` therefore *executes*
it in a stand-in worker scope and drives its handlers with synthetic events —
that test is the only gate it has.

### 81.3 Registration is production-only, and dev unregisters

`ServiceWorkerRegistrar` (mounted in the root layout, so the sign-in page can
be installed from too) registers only when `NODE_ENV === 'production'` and
actively unregisters otherwise. A worker installed by a production build
outlives the page that registered it and would go on intercepting navigations
against the dev server on the same localhost origin. It also keeps the worker
out of the e2e suite, which runs against `next dev`.

Registration failures are swallowed: a non-secure origin or a browser that
blocks workers costs installability and nothing else, and must never surface to
the user.

### 81.4 The two colours that can't be tokens

`src/lib/pwa.ts` holds the manifest's `theme_color`/`background_color` and the
`<meta name="theme-color">` pair as literal `rgb()` values — the only colours
in the app that aren't a `var()`. A manifest is JSON handed to the OS and the
meta tag is read before any stylesheet is parsed; neither can dereference a
custom property.

`yarn lint:tokens` can't guard them, so `src/app/manifest.test.ts` does: it
resolves `--background` out of `globals.css` for both themes, converts oklch to
sRGB, and asserts the literals still match. Same idea for the icons — the test
reads each PNG's IHDR chunk and checks the file exists and is the size the
manifest claims.

The icons themselves are generated by `scripts/generate-pwa-icons.mjs` (headless
Chromium, the brand gradient in the same `oklch()` values as `globals.css`, the
glyph in the same vendored Instrument Sans). They're committed; re-run the
script and commit the PNGs when the mark changes. The maskable icon is a
separate file from the `any` ones on purpose: maskable is full-bleed and cropped
to the platform's shape inside an 80% safe zone, so one icon declared as both
purposes is wrong for one of them.

The icon and splash screen can't follow the user's selected accent — they're
baked into the launcher entry at install time — so they use the default accent
(Aurora).
