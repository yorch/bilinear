---
paths:
  - "src/server/**/*.ts"
  - "prisma/**/*.{ts,prisma,sql}"
  - "src/app/api/**/*.ts"
---

# Server, GraphQL and database conventions

Long-form reference: `docs/PATTERNS.md`, `docs/API_DESIGN.md`,
`docs/DATABASE_SCHEMA.md`.

## Boundaries

`src/server/` is backend only and must never be imported by client code. It holds
GraphQL resolvers, services, middleware, and lib singletons.

## Resolver → service

Resolvers are thin: `requireAuth(ctx)` → `ctx.services.<domain>.method()` →
return the result with `lastSyncId`. All business logic lives in services.
Services return plain objects, never GraphQL types. Error classes are internal to
each service; resolvers catch and remap to `GraphQLError` with
`extensions.code`.

## GraphQL

- Error discriminator is `extensions.code`: `UNAUTHENTICATED`, `NOT_FOUND`,
  `INVALID_CODE`, `INVALID_TOKEN`, `FORBIDDEN`, `RATELIMITED`, `BAD_USER_INPUT`.
- Mutations return `{ success, <entity>, lastSyncId }` — `lastSyncId` is a string
  (BIGSERIAL).
- **Every mutation must create a SyncAction:**
  `ctx.services.sync.createSyncAction(orgId, action, model, id, data)`. A row
  written without one is invisible to every other client until something
  coincidentally re-touches it.
- Every argument and input field naming an entity is `ID`/`ID!`, never
  `String`/`String!` — GraphQL compares the *declared* variable type against the
  argument type, so a mismatch is a runtime coin flip. A schema assertion
  enforces this over input fields and arguments. See PATTERNS.md §80.1.

## Database

- UUID PKs, soft delete via `archivedAt`, audit timestamps on all models.
- snake_case DB columns (`@map`), timezone-aware datetimes (`@db.Timestamptz`).
- Derived values are computed GraphQL fields, never columns. Columns that nothing
  writes go stale silently — this has bitten the codebase twice
  (`projects.progress`/`scope`, then the same six on `cycles`). See PATTERNS.md
  §80.7 and DATABASE_SCHEMA.md §2.9-pre.
- Nothing is deployed yet, so **anything Prisma's DSL can express belongs in the
  regenerated `00000000000000_init` baseline**, not stacked on as an additive
  migration. Only SQL Prisma cannot express (partial/expression indexes, FTS
  triggers, `String[] NOT NULL`) lives in
  `00000000000001_custom_constraints_and_triggers`. Verify with the real-Postgres
  recipe in DATABASE_SCHEMA.md before deploying — `prisma migrate diff` is
  expected to emit exactly one `DROP INDEX` for the xid8 covering index, because
  Prisma cannot declare `@@index` on an `Unsupported` field.

## Configuration

Behaviour knobs are **registry entries, not env vars and not columns**. One
`defineSetting` in `src/lib/config/registry.ts`, read through `ConfigService`
(`config.getInt('webhook.maxAttempts', { orgId })`). Precedence is
code default → env → platform → org → team → user.

- `process.env` is for secrets, connection strings, and values read before a DB
  connection exists. Those are declared `storage: 'env-only'`.
- **A registered knob must have a consumer.** A declaration nothing enforces
  reports a setting that does nothing.
- Services take a `ConfigReader` defaulting to `DEFAULTS_ONLY_CONFIG`, so unit
  tests against mocked Prisma still resolve the code default without a query.
  That default is a test affordance: pass the real service from `context.ts`,
  `loaders.ts`, the route handlers that build services directly, and the WS/YJS
  entry points. Forgetting is silent — the service just ignores every configured
  value.
- `editableBy` gates *the knob*; reaching a scope gates *the caller*, and the
  settings resolver checks that separately. Platform scope needs
  `requirePlatformAdmin`, team scope needs `requireTeamMember` unless the caller
  administers the org.
- `settings.value` is `Json`, so the DB validates nothing — the registry
  validator is the only guard on a write.
- **Never `instanceof` a registry error class from server code.** `src/lib/config`
  is bundled twice (SSR chunk + server chunk), so the class has two identities
  and the check silently fails — every validation error became
  `INTERNAL_SERVER_ERROR`. Use `isInvalidSettingValueError`. Vitest sees one
  copy, so no unit test catches it.

See PATTERNS.md §10 and docs/CONFIG_ASSESSMENT.md.

## Prisma 7 split config

- **CLI** (`migrate`, `generate`) uses `prisma.config.ts` with
  `defineConfig({ datasource: { url } })`.
- **Runtime** uses `@prisma/adapter-pg` in `src/server/lib/prisma.ts`.
- Generated client lands in `src/generated/prisma/` (gitignored — run
  `yarn db:generate` after checkout or any schema change).

## Auth

- Magic link email with 6-digit codes. Hash before storing
  (`crypto.createHash('sha256')`). CSPRNG only (`crypto.randomInt`).
- JWT via `jose` (edge-compatible). Access tokens 24h, refresh tokens 30d in
  httpOnly cookies.
- `requireAuth(ctx)` uses TypeScript `asserts` narrowing.
- Tenant guards (`requireTeamMember` / `requireTeamOwner`) take an explicit
  `orgId` and verify the team belongs to it.
- E2E test bypass: `NODE_ENV=test` + `TEST_AUTH_CODE=000000`.

## Logging

Use `logger` / `childLogger` from `@/server/lib/logger` (pino). No `console.log`
in server code.
