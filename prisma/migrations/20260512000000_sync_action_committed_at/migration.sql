-- Adds a `committed_at` column to `sync_actions` populated at COMMIT time
-- via a trigger that uses `statement_timestamp()`. Used by delta-sync as a
-- monotonic watermark to close the BIGSERIAL ordering hole: ids are
-- assigned at INSERT, but transactions commit out of order; a client that
-- records `lastSyncId = max(id)` could otherwise miss a row whose id is
-- lower but commits later. The delta query orders by (committed_at, id)
-- and ignores rows newer than `now() - 500ms` so all concurrent inserts
-- have flushed.

ALTER TABLE sync_actions
  ADD COLUMN committed_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- Trigger function: stamp committed_at to the statement's start time so
-- that ordering by committed_at corresponds to wall-clock ordering at
-- INSERT. Combined with the safety window in getDeltaSyncActions, this
-- gives us "monotonic when read after the safety window has elapsed".
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

-- Composite index that powers (organizationId, committed_at, id) cursoring.
-- Includes id last so we can break ties deterministically when two rows
-- share the same statement_timestamp.
CREATE INDEX sync_actions_org_committed_at_id_idx
  ON sync_actions (organization_id, committed_at, id);
