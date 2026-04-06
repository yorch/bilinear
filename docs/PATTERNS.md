# Code Patterns
## Issue Tracker — Linear Rebuild

**Established:** Sprint 1-2  
**Status:** Living document — updated each sprint

> This is the primary onboarding document for new contributors. All patterns here are the mandated conventions for the codebase. If you deviate from a pattern, document why.

---

## 1. Project Structure

```
src/
├── app/                        # Next.js App Router (pages + API routes)
│   ├── (auth)/                 # Route group: no sidebar, centered layout
│   ├── (workspace)/            # Route group: authenticated, sidebar layout
│   └── api/                    # API routes (GraphQL, session)
├── server/                     # Backend-only code — never import from client
│   ├── graphql/                # schema.ts, context.ts, resolvers/, types/
│   ├── services/               # Business logic (one class per domain)
│   ├── lib/                    # Singletons: prisma, redis, jwt, email
│   └── middleware/             # Auth extraction + guards
├── components/                 # React components (client-safe)
│   ├── ui/                     # shadcn/ui primitives
│   ├── layouts/                # App shell, sidebar
│   └── <feature>/              # Feature-grouped components
└── hooks/                      # React hooks
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

---

## 5. GraphQL Context Pattern

Context is built per-request from the incoming headers/cookies:

```typescript
// src/server/graphql/context.ts
export interface GraphQLContext {
  userId: string | null;
  orgId: string | null;
  services: { auth: AuthService; user: UserService };
}

export async function createContext(req: NextRequest): Promise<GraphQLContext> {
  const auth = await extractAuthContext(
    req.headers.get('authorization'),
    req.cookies.get('access_token')?.value ?? null,
  );
  const userService = new UserService(prisma);
  return { ...auth, services: { auth: new AuthService(prisma, userService), user: userService } };
}
```

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
