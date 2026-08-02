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
-- sync_actions.xact_id covering index (commit-order fence)
-- ---------------------------------------------------------------------------
-- The `xact_id xid8 DEFAULT pg_current_xact_id()` column itself is Prisma-
-- expressible (an `Unsupported` type with a `dbgenerated` default) and lives
-- in the generated init baseline. This index is the part Prisma cannot declare
-- — `@@index` rejects an `Unsupported`-typed field — so it lives here.
--
-- It is load-bearing for delta sync: `SyncService.getDeltaSyncActions` orders
-- by `(xact_id, id)` and reads only rows with
-- `xact_id < pg_snapshot_xmin(pg_current_snapshot())` — rows whose transaction
-- has SETTLED and below which no transaction is still in flight. That is a
-- provably never-skip cursor, replacing the former `committed_at =
-- statement_timestamp()` + 500ms wall-clock window, which could still miss a
-- row whose transaction inserted early but committed more than the window later
-- (BIGSERIAL ids are assigned at INSERT but commit out of order). Fencing on
-- the transaction id removes the wall-clock guess entirely: an in-flight xid
-- keeps its rows fenced until it actually commits, however long that takes.
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

-- ---------------------------------------------------------------------------
-- Active-issues partial index (§2.1 DB hardening)
-- ---------------------------------------------------------------------------
-- Serves the per-team active list view (the most-rendered issue query): issues
-- on a team, filtered to a state, excluding archived/trashed rows. A partial
-- index keyed on the same predicate the list uses keeps it small (dead rows
-- excluded) and lets Postgres satisfy the filter from the index alone. Prisma's
-- @@index can't carry a WHERE predicate, so it lives here.
CREATE INDEX "issues_team_id_state_id_active_idx"
  ON "issues" ("team_id", "state_id")
  WHERE "archived_at" IS NULL AND "trashed" = false;
