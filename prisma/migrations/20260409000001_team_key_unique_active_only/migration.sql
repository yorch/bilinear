-- Migration: team_key_unique_active_only
-- Replace the absolute unique constraint on (organization_id, key) with a
-- partial unique index that only covers non-archived teams, so a soft-deleted
-- team's key can be reused.

DROP INDEX "teams_organization_id_key_key";

CREATE UNIQUE INDEX "teams_organization_id_key_key"
  ON "teams" ("organization_id", "key")
  WHERE "archived_at" IS NULL;
