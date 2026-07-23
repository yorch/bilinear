-- ----------------------------------------------------------------------------
-- Custom DDL that Prisma's schema DSL cannot express. Applied after the
-- consolidated init that the Prisma generator produced.
-- ----------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Partial unique on teams: allow archived team keys to be reused
-- ---------------------------------------------------------------------------
-- Active (non-archived) teams in an organization must have unique keys, but
-- archived teams should not block key reuse. Prisma's @@unique doesn't take
-- a WHERE predicate, so the constraint lives in raw SQL. The schema-emitted
-- `teams_organization_id_key_idx` (non-unique, full) coexists for general
-- lookup; this partial unique enforces integrity for the live set.
CREATE UNIQUE INDEX "teams_organization_id_key_key"
  ON "teams" ("organization_id", "key")
  WHERE "archived_at" IS NULL;

-- ---------------------------------------------------------------------------
-- Auth-token partial indexes: refresh unique, magic-link non-unique
-- ---------------------------------------------------------------------------
-- Magic-link rows hash a 6-digit numeric code (1M-value space) where
-- cross-user hash collisions are mathematically expected; a blanket unique
-- index on `token_hash` would randomly fail INSERTs in production.
-- Refresh tokens hash long random strings — collisions are ~0, so a partial
-- unique catches double-issuance bugs for that path without affecting
-- magic-link issuance. See AuthToken schema comments and
-- src/server/services/auth.service.ts for runtime semantics.
CREATE UNIQUE INDEX "auth_tokens_token_hash_refresh_key"
  ON "auth_tokens"("token_hash")
  WHERE "type" = 'refresh';

CREATE INDEX "auth_tokens_token_hash_magic_link_idx"
  ON "auth_tokens"("token_hash")
  WHERE "type" = 'magic_link';

-- ---------------------------------------------------------------------------
-- sync_actions.xact_id commit-order fence
-- ---------------------------------------------------------------------------
-- Stamps every insert with the writing transaction's 64-bit transaction id
-- (`pg_current_xact_id()` → xid8, no wraparound). Delta sync
-- (SyncService.getDeltaSyncActions) orders by `(xact_id, id)` and reads only
-- rows with `xact_id < pg_snapshot_xmin(pg_current_snapshot())` — i.e. rows
-- whose transaction has SETTLED and below which no transaction is still in
-- flight. This is a provably never-skip cursor: it replaces the former
-- `committed_at = statement_timestamp()` + 500ms wall-clock safety window,
-- which could still miss a row whose transaction inserted early but committed
-- more than the window later (BIGSERIAL ids are assigned at INSERT but commit
-- out of order — a client recording lastSyncId=max(id) could skip a
-- lower-id-but-later-commit row). Fencing on the transaction id instead of a
-- timestamp removes the wall-clock guess entirely: an in-flight xid keeps its
-- rows fenced until it actually commits, regardless of how long that takes.
-- Load-bearing for delta sync.
--
-- Prisma's DSL cannot express the `xid8` type, the `pg_current_xact_id()`
-- default, or an index on an Unsupported-typed column, so the column and its
-- covering index live here rather than in the generated init. `pg_current_xact_id()`
-- returns the xid the INSERT already assigns, so this consumes no extra xids
-- beyond what the write itself does.
ALTER TABLE "sync_actions"
  ADD COLUMN "xact_id" xid8 NOT NULL DEFAULT pg_current_xact_id();

CREATE INDEX "sync_actions_organization_id_xact_id_id_idx"
  ON "sync_actions" ("organization_id", "xact_id", "id");

-- ---------------------------------------------------------------------------
-- Full-text search GIN index on issues
-- ---------------------------------------------------------------------------
-- Powers the searchIssues GraphQL query in SearchService via:
--   to_tsvector('english', title || ' ' || COALESCE(description, ''))
-- Prisma's @@index(type: Gin) supports column lists but not arbitrary
-- to_tsvector(...) expressions, so this expression-based GIN lives in raw
-- SQL.
CREATE INDEX IF NOT EXISTS idx_issues_fts
  ON issues
  USING GIN (to_tsvector('english', title || ' ' || COALESCE(description, '')));

-- ---------------------------------------------------------------------------
-- Preserve NOT NULL on String[] columns (Prisma 7 array gotcha)
-- ---------------------------------------------------------------------------
-- Prisma 7 emits String[] columns as nullable at the DB level even though
-- the client treats them as never-null at the TypeScript level. The
-- pre-consolidation migrations declared webhooks.events and
-- auth_tokens.scopes NOT NULL explicitly; reinstate the DB-level constraint
-- here so raw-SQL writes that omit the array still fail loudly.
-- issues.previous_identifiers was already nullable in the original init, so
-- it does not need preserving.
ALTER TABLE "webhooks"
  ALTER COLUMN "events" SET NOT NULL;

ALTER TABLE "auth_tokens"
  ALTER COLUMN "scopes" SET NOT NULL;
