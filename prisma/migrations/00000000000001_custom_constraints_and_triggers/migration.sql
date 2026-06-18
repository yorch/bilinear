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
-- sync_actions.committed_at trigger
-- ---------------------------------------------------------------------------
-- Stamps committed_at to the statement's start time on every INSERT so
-- ordering by committed_at corresponds to wall-clock order. Combined with
-- the 500ms safety window + (organization_id, committed_at, id) cursor in
-- SyncService.getDeltaSyncActions, this closes the BIGSERIAL ordering hole
-- (ids are assigned at INSERT but transactions commit out of order — a
-- client recording lastSyncId=max(id) could otherwise miss a row whose id
-- is lower but commits later). Load-bearing for delta sync.
--
-- The assignment is UNCONDITIONAL on purpose. The column carries a DB DEFAULT
-- (CURRENT_TIMESTAMP, from `@default(now())` in schema.prisma), and PostgreSQL
-- materializes column DEFAULTs into NEW *before* BEFORE INSERT triggers fire.
-- A guarded `IF NEW.committed_at IS NULL` would therefore never run — NEW
-- always arrives pre-populated with the (wrong, transaction-START) default.
-- Overwriting it here with statement_timestamp() is what makes the watermark
-- correct, and is robust even if a future `prisma migrate`/`db push` re-adds
-- the default.
CREATE OR REPLACE FUNCTION sync_action_set_committed_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.committed_at := statement_timestamp();
  RETURN NEW;
END;
$$;

CREATE TRIGGER set_sync_action_committed_at
  BEFORE INSERT ON sync_actions
  FOR EACH ROW EXECUTE FUNCTION sync_action_set_committed_at();

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
