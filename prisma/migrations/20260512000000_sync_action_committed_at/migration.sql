-- Adds a `committed_at` column to `sync_actions` populated at INSERT time
-- via a trigger that uses `statement_timestamp()`. Combined with the
-- safety window + `(committed_at, id)` tuple cursor in
-- SyncService.getDeltaSyncActions, this closes the BIGSERIAL ordering
-- hole: ids are assigned at INSERT, but transactions commit out of
-- order, so a client that recorded `lastSyncId = max(id)` could miss a
-- row whose id is lower but commits later. The cursor advances strictly
-- by `(committed_at, id)` instead.
--
-- Migration is written to avoid a full table rewrite on existing tables:
--
--  1. Add the column NULLable with no default. Postgres 11+ recognises
--     this as a metadata-only change (no rewrite, no exclusive lock past
--     the ALTER itself).
--  2. Install the BEFORE INSERT trigger so all new rows are populated.
--  3. Backfill existing rows in a single UPDATE — `sync_actions` is the
--     hot append-only ledger so on most installs this is small. The
--     backfill uses `created_at` as the best available approximation of
--     the original commit time (the trigger's `statement_timestamp` is
--     not retroactive). Operators with very large existing tables should
--     replace this with a batched backfill before running.
--  4. Set NOT NULL once every row is populated. A single existence-check
--     scan is unavoidable here, but it's a fast index scan rather than
--     a full table rewrite.
--  5. Add the composite index that powers the new cursor.

ALTER TABLE sync_actions
  ADD COLUMN committed_at TIMESTAMPTZ;

-- Trigger function: stamp committed_at to the statement's start time so
-- ordering by committed_at corresponds to wall-clock ordering at INSERT.
-- Combined with the safety window in getDeltaSyncActions, this gives us
-- "monotonic when read after the safety window has elapsed".
CREATE OR REPLACE FUNCTION sync_action_set_committed_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.committed_at IS NULL THEN
    NEW.committed_at := statement_timestamp();
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER set_sync_action_committed_at
  BEFORE INSERT ON sync_actions
  FOR EACH ROW EXECUTE FUNCTION sync_action_set_committed_at();

-- Backfill: pre-existing rows get their created_at as committed_at. They
-- predate the strict ordering guarantee but this keeps the column NOT
-- NULLable. For an installation with millions of existing rows, replace
-- this with a chunked job before running migration.
UPDATE sync_actions SET committed_at = created_at WHERE committed_at IS NULL;

ALTER TABLE sync_actions ALTER COLUMN committed_at SET NOT NULL;
ALTER TABLE sync_actions ALTER COLUMN committed_at SET DEFAULT now();

-- Composite index that powers (organization_id, committed_at, id) cursoring.
-- Created concurrently can't be used inside a migration (must run outside
-- a transaction); fall back to a normal CREATE INDEX, which takes an
-- ACCESS EXCLUSIVE lock briefly. For a fresh deployment this is fine; on
-- an existing large table, switch to CREATE INDEX CONCURRENTLY post-deploy.
CREATE INDEX sync_actions_org_committed_at_id_idx
  ON sync_actions (organization_id, committed_at, id);
