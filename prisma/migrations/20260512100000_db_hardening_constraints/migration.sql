-- Additive constraints + indexes from REVIEW_BACKLOG.md §2.4.
--
-- Five low-risk schema tightenings that closed open gaps in REVIEW_BACKLOG.md:
--
--   1. `users.google_id` UNIQUE — prevents two accounts from claiming the
--      same Google identity. Currently unenforced; relies on the OAuth
--      callback being well-behaved.
--   2. `issues.previous_identifiers` GIN index — supports identifier-history
--      lookups (a renamed issue is still findable by its old key).
--   3. `teams.default_issue_state_id` / `auto_close_state_id` FKs to
--      `workflow_states(id)` with `ON DELETE SET NULL` — previously raw UUID
--      columns with no referential integrity, so deleting a workflow state
--      left dangling references.
--   4. `files.project_id` FK to `projects(id)` with `ON DELETE SET NULL` —
--      same shape as (3); the `issue_id` FK already exists.
--   5. `auth_tokens.token_hash` partial UNIQUE — refresh tokens hash long
--      random strings (collisions ≈ 0); the constraint catches any bug
--      that issues the same hash twice. **Excludes** `magic_link` rows,
--      which hash a 6-digit code (1M possibilities) where collisions
--      across users are mathematically expected. If `api_key` (or any
--      other random-string token type) is added later, extend the
--      predicate in a follow-up migration.
--
-- Each block is fenced by an integrity-check that fails loudly if the
-- migration would corrupt existing data — see the comments inline.

-- ---------------------------------------------------------------------------
-- 1. users.google_id UNIQUE
-- ---------------------------------------------------------------------------

-- Pre-flight: any existing dupes will break the unique index creation.
-- Two rows sharing a google_id is a data bug, not a migration concern —
-- abort and let an operator triage before continuing.
DO $$
DECLARE
  dupes INT;
BEGIN
  SELECT count(*) INTO dupes FROM (
    SELECT google_id FROM users
     WHERE google_id IS NOT NULL
     GROUP BY google_id HAVING count(*) > 1
  ) d;
  IF dupes > 0 THEN
    RAISE EXCEPTION
      'users.google_id has % duplicate value(s); resolve before applying this migration',
      dupes;
  END IF;
END $$;

CREATE UNIQUE INDEX "users_google_id_key" ON "users"("google_id");

-- ---------------------------------------------------------------------------
-- 2. issues.previous_identifiers GIN
-- ---------------------------------------------------------------------------

CREATE INDEX "issues_previous_identifiers_idx"
  ON "issues" USING GIN ("previous_identifiers");

-- ---------------------------------------------------------------------------
-- 3. teams.default_issue_state_id / auto_close_state_id FKs
-- ---------------------------------------------------------------------------

-- Pre-flight cleanup: any team pointing at a workflow_state that no longer
-- exists would fail the FK creation. Null-out orphans before adding the
-- constraint. ON DELETE SET NULL covers the steady-state case (someone
-- archives a workflow state); the cleanup here covers historical drift
-- from before the FK existed.
UPDATE "teams"
   SET "default_issue_state_id" = NULL
 WHERE "default_issue_state_id" IS NOT NULL
   AND "default_issue_state_id" NOT IN (SELECT "id" FROM "workflow_states");

UPDATE "teams"
   SET "auto_close_state_id" = NULL
 WHERE "auto_close_state_id" IS NOT NULL
   AND "auto_close_state_id" NOT IN (SELECT "id" FROM "workflow_states");

ALTER TABLE "teams"
  ADD CONSTRAINT "teams_default_issue_state_id_fkey"
    FOREIGN KEY ("default_issue_state_id")
    REFERENCES "workflow_states"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "teams"
  ADD CONSTRAINT "teams_auto_close_state_id_fkey"
    FOREIGN KEY ("auto_close_state_id")
    REFERENCES "workflow_states"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- Index the referencing columns so the FK's ON DELETE SET NULL check
-- doesn't seq-scan `teams` whenever a workflow_state is deleted.
CREATE INDEX "teams_default_issue_state_id_idx"
  ON "teams"("default_issue_state_id");

CREATE INDEX "teams_auto_close_state_id_idx"
  ON "teams"("auto_close_state_id");

-- ---------------------------------------------------------------------------
-- 4. files.project_id FK
-- ---------------------------------------------------------------------------

UPDATE "files"
   SET "project_id" = NULL
 WHERE "project_id" IS NOT NULL
   AND "project_id" NOT IN (SELECT "id" FROM "projects");

ALTER TABLE "files"
  ADD CONSTRAINT "files_project_id_fkey"
    FOREIGN KEY ("project_id")
    REFERENCES "projects"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- 5. auth_tokens.token_hash partial UNIQUE (refresh only)
-- ---------------------------------------------------------------------------
--
-- Magic-link rows hash a 6-digit numeric code (`crypto.randomInt(100000,
-- 1000000)` → 1,000,000 possible values). At any non-trivial scale,
-- concurrent magic-link issuances across users will produce identical
-- `token_hash` values by birthday-paradox math; a blanket unique index
-- would randomly fail INSERTs in production.
--
-- Refresh tokens hash long random strings — collisions are ~0. The
-- partial unique catches double-issuance bugs for that path without
-- touching the magic-link one.
--
-- `verifyMagicLink` already disambiguates by `(userId, tokenHash, type)`,
-- so the absence of a magic-link uniqueness constraint is correct for
-- the lookup as well.
--
-- The predicate uses `type = 'refresh'` (matching the runtime lookup
-- verbatim) rather than `type <> 'magic_link'` so PostgreSQL's planner
-- reliably uses the partial index for `WHERE token_hash = ? AND type =
-- 'refresh'` queries. If a future `api_key` (or similar long-random-
-- string) token type is added, extend the predicate in a follow-up.

-- Pre-flight: any existing duplicate hashes among refresh rows would
-- block index creation. Fail loud rather than silently drop the
-- constraint.
DO $$
DECLARE
  dupes INT;
BEGIN
  SELECT count(*) INTO dupes FROM (
    SELECT token_hash FROM auth_tokens
     WHERE type = 'refresh'
     GROUP BY token_hash HAVING count(*) > 1
  ) d;
  IF dupes > 0 THEN
    RAISE EXCEPTION
      'auth_tokens has % duplicate token_hash value(s) among refresh rows; resolve before applying this migration',
      dupes;
  END IF;
END $$;

-- Drop the legacy non-unique index — the partial unique below covers the
-- common-case lookup (`WHERE token_hash = ? AND type = 'refresh'`).
DROP INDEX "auth_tokens_token_hash_idx";

CREATE UNIQUE INDEX "auth_tokens_token_hash_refresh_key"
  ON "auth_tokens"("token_hash")
  WHERE "type" = 'refresh';

-- Keep a non-unique index for magic-link lookups so verifyMagicLink stays
-- on an indexed path.
CREATE INDEX "auth_tokens_token_hash_magic_link_idx"
  ON "auth_tokens"("token_hash")
  WHERE "type" = 'magic_link';
