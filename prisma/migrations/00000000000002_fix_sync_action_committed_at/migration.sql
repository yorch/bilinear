-- ----------------------------------------------------------------------------
-- Fix: sync_actions.committed_at was never set by its trigger.
-- ----------------------------------------------------------------------------
-- The `committed_at` column carries a DB DEFAULT (CURRENT_TIMESTAMP, emitted
-- from `@default(now())` in schema.prisma). PostgreSQL materializes column
-- DEFAULTs into NEW *before* BEFORE INSERT triggers fire, so the previous
-- trigger body — which only assigned `statement_timestamp()` when
-- `NEW.committed_at IS NULL` — never executed. Every row got the
-- transaction-START time (CURRENT_TIMESTAMP == transaction_timestamp()),
-- not the statement time the watermark relies on.
--
-- That silently re-opened the BIGSERIAL out-of-order-commit hole the watermark
-- was meant to close (see SyncService.getDeltaSyncActions + DATABASE_SCHEMA.md
-- §2.22): a long-running transaction commits late but stamps an early
-- committed_at, so a client recording lastSyncId could skip it.
--
-- Set committed_at UNCONDITIONALLY. Because the BEFORE INSERT trigger runs
-- after the default is applied, this overrides the column default and is
-- robust even if a future `prisma migrate`/`db push` re-adds it.
CREATE OR REPLACE FUNCTION sync_action_set_committed_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.committed_at := statement_timestamp();
  RETURN NEW;
END;
$$;

-- Trigger `set_sync_action_committed_at` already references this function
-- (created in 00000000000001); replacing the function body is sufficient.
